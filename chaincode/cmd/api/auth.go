package main

// Accounts and sessions (deployment/postgres_auth.sql). Each account acts
// for one patient or one organisation, and handlers use it to decide what
// the caller may do: a patient changes only their own consent, a provider
// requests and opens only its own requests, and only the regulator reads
// the whole audit log. Passwords are checked with pgcrypto's crypt(), so
// the API never hashes or compares passwords itself. Sessions are random
// tokens in an HttpOnly cookie; the database stores only their SHA-256.

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	sessionCookie = "cl_session"
	sessionTTL    = 8 * time.Hour
)

// User is the signed-in account. PatientID is set for patients; ProviderID
// and ProviderType for providers and the regulator.
type User struct {
	UserID       string `json:"userId"`
	Username     string `json:"username"`
	Role         string `json:"role"`
	PatientID    string `json:"patientId,omitempty"`
	ProviderID   string `json:"providerId,omitempty"`
	ProviderType string `json:"providerType,omitempty"`
	Organization string `json:"organization,omitempty"`
	DisplayName  string `json:"displayName"`
	Email        string `json:"email"`
	Phone        string `json:"phone"`
}

const userColumns = `u.user_id, u.username, u.role, coalesce(u.patient_id, ''), coalesce(u.provider_id, ''),
	coalesce(p.provider_type, ''), coalesce(p.organization, ''), u.display_name, coalesce(u.email, ''), coalesce(u.phone, '')`

func scanUser(row pgx.Row) (*User, error) {
	var u User
	err := row.Scan(&u.UserID, &u.Username, &u.Role, &u.PatientID, &u.ProviderID, &u.ProviderType, &u.Organization, &u.DisplayName, &u.Email, &u.Phone)
	return &u, err
}

type ctxKey struct{}

func userFrom(r *http.Request) *User {
	u, _ := r.Context().Value(ctxKey{}).(*User)
	return u
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// requireUser rejects requests without a valid session and makes the
// account available to the handler through userFrom.
func requireUser(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(sessionCookie)
		if err != nil || c.Value == "" {
			writeErr(w, http.StatusUnauthorized, errors.New("sign in to continue"))
			return
		}
		u, err := scanUser(db.QueryRow(r.Context(),
			`SELECT `+userColumns+` FROM app_sessions s
			   JOIN app_users u ON u.user_id = s.user_id
			   LEFT JOIN providers p ON p.provider_id = u.provider_id
			  WHERE s.token_hash = $1 AND s.expires_at > now()`, hashToken(c.Value)))
		if errors.Is(err, pgx.ErrNoRows) {
			clearSessionCookie(w)
			writeErr(w, http.StatusUnauthorized, errors.New("your session has expired; sign in again"))
			return
		}
		if err != nil {
			log.Printf("session lookup failed: %v", err)
			writeErr(w, http.StatusBadGateway, errors.New("off-chain store unavailable"))
			return
		}
		next(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, u)))
	}
}

func setSessionCookie(w http.ResponseWriter, token string, expires time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    token,
		Path:     "/",
		Expires:  expires,
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
	})
}

func clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteStrictMode})
}

// loginLimiter slows password guessing: at most 5 failed attempts per
// username in 5 minutes.
var loginLimiter = struct {
	sync.Mutex
	fails map[string][]time.Time
}{fails: map[string][]time.Time{}}

func tooManyFailures(username string) bool {
	loginLimiter.Lock()
	defer loginLimiter.Unlock()
	cutoff := time.Now().Add(-5 * time.Minute)
	recent := loginLimiter.fails[username][:0]
	for _, t := range loginLimiter.fails[username] {
		if t.After(cutoff) {
			recent = append(recent, t)
		}
	}
	loginLimiter.fails[username] = recent
	return len(recent) >= 5
}

func noteFailure(username string, ok bool) {
	loginLimiter.Lock()
	defer loginLimiter.Unlock()
	if ok {
		delete(loginLimiter.fails, username)
		return
	}
	loginLimiter.fails[username] = append(loginLimiter.fails[username], time.Now())
}

// POST /auth/login  {username, password}
func handleLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	username := strings.ToLower(strings.TrimSpace(req.Username))
	if tooManyFailures(username) {
		writeErr(w, http.StatusTooManyRequests, errors.New("too many failed attempts; wait a few minutes and try again"))
		return
	}
	u, err := scanUser(db.QueryRow(r.Context(),
		`SELECT `+userColumns+` FROM app_users u LEFT JOIN providers p ON p.provider_id = u.provider_id
		  WHERE u.username = $1 AND u.password_hash = crypt($2, u.password_hash)`, username, req.Password))
	if errors.Is(err, pgx.ErrNoRows) {
		noteFailure(username, false)
		writeErr(w, http.StatusUnauthorized, errors.New("incorrect username or password"))
		return
	}
	if err != nil {
		log.Printf("login query failed: %v", err)
		writeErr(w, http.StatusBadGateway, errors.New("off-chain store unavailable"))
		return
	}
	noteFailure(username, true)

	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	expires := time.Now().Add(sessionTTL)
	if _, err := db.Exec(r.Context(),
		`INSERT INTO app_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)`, hashToken(token), u.UserID, expires); err != nil {
		log.Printf("creating session failed: %v", err)
		writeErr(w, http.StatusBadGateway, errors.New("off-chain store unavailable"))
		return
	}
	// Housekeeping: drop expired sessions.
	_, _ = db.Exec(r.Context(), `DELETE FROM app_sessions WHERE expires_at <= now()`)
	setSessionCookie(w, token, expires)
	writeJSON(w, http.StatusOK, u)
}

// POST /auth/logout
func handleLogout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil && c.Value != "" {
		_, _ = db.Exec(r.Context(), `DELETE FROM app_sessions WHERE token_hash = $1`, hashToken(c.Value))
	}
	clearSessionCookie(w)
	writeJSON(w, http.StatusOK, map[string]string{"status": "signed out"})
}

// GET /auth/me
func handleMe(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, userFrom(r))
}

var emailPattern = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

// PUT /auth/profile  {displayName, email, phone}
func handleUpdateProfile(w http.ResponseWriter, r *http.Request) {
	var req struct {
		DisplayName string `json:"displayName"`
		Email       string `json:"email"`
		Phone       string `json:"phone"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	req.DisplayName, req.Email, req.Phone = strings.TrimSpace(req.DisplayName), strings.TrimSpace(req.Email), strings.TrimSpace(req.Phone)
	switch {
	case req.DisplayName == "" || len(req.DisplayName) > 80:
		writeErr(w, http.StatusBadRequest, errors.New("enter a name of up to 80 characters"))
		return
	case req.Email != "" && !emailPattern.MatchString(req.Email):
		writeErr(w, http.StatusBadRequest, errors.New("enter a valid email address"))
		return
	case len(req.Phone) > 30:
		writeErr(w, http.StatusBadRequest, errors.New("enter a phone number of up to 30 characters"))
		return
	}
	u := userFrom(r)
	if _, err := db.Exec(r.Context(), `UPDATE app_users SET display_name = $1, email = nullif($2, ''), phone = nullif($3, '') WHERE user_id = $4`,
		req.DisplayName, req.Email, req.Phone, u.UserID); err != nil {
		log.Printf("updating profile failed: %v", err)
		writeErr(w, http.StatusBadGateway, errors.New("off-chain store unavailable"))
		return
	}
	u.DisplayName, u.Email, u.Phone = req.DisplayName, req.Email, req.Phone
	writeJSON(w, http.StatusOK, u)
}

// POST /auth/password  {currentPassword, newPassword}
//
// Signs out the account's other sessions, so a changed password takes
// effect everywhere.
func handleChangePassword(w http.ResponseWriter, r *http.Request) {
	var req struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	if len(req.NewPassword) < 8 || len(req.NewPassword) > 72 {
		writeErr(w, http.StatusBadRequest, errors.New("choose a new password of 8 to 72 characters"))
		return
	}
	if req.NewPassword == req.CurrentPassword {
		writeErr(w, http.StatusBadRequest, errors.New("choose a password different from your current one"))
		return
	}
	u := userFrom(r)
	tag, err := db.Exec(r.Context(),
		`UPDATE app_users SET password_hash = crypt($1, gen_salt('bf', 10))
		  WHERE user_id = $2 AND password_hash = crypt($3, password_hash)`, req.NewPassword, u.UserID, req.CurrentPassword)
	if err != nil {
		log.Printf("changing password failed: %v", err)
		writeErr(w, http.StatusBadGateway, errors.New("off-chain store unavailable"))
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, http.StatusBadRequest, errors.New("your current password is incorrect"))
		return
	}
	c, _ := r.Cookie(sessionCookie)
	_, _ = db.Exec(r.Context(), `DELETE FROM app_sessions WHERE user_id = $1 AND token_hash <> $2`, u.UserID, hashToken(c.Value))
	writeJSON(w, http.StatusOK, map[string]string{"status": "password changed"})
}

var errForbidden = errors.New("your account is not allowed to do that")

// canSeeRequest reports whether u may see an access request's status and
// log entry: the requesting provider, the patient it concerns, or the
// regulator.
func canSeeRequest(u *User, providerID, patientID string) bool {
	switch u.Role {
	case "regulator":
		return true
	case "provider":
		return u.ProviderID == providerID
	case "patient":
		return u.PatientID == patientID
	}
	return false
}

// canSeeConsent reports whether u may read a patient/provider consent: the
// patient, the provider it names, the data-holding hospital (which
// releases records), or the regulator.
func canSeeConsent(u *User, patientID, providerID string) bool {
	switch u.Role {
	case "regulator":
		return true
	case "provider":
		return u.ProviderID == providerID || u.ProviderType == "hospital"
	case "patient":
		return u.PatientID == patientID
	}
	return false
}

func forbid(w http.ResponseWriter, why string) {
	writeErr(w, http.StatusForbidden, fmt.Errorf("%w: %s", errForbidden, why))
}
