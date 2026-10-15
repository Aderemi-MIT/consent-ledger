// Command api exposes the consentaccess chaincode over a small REST API,
// acting as the application layer's bridge into the Fabric network
// (Section 3.4.1(a)/(b)) so the five functions can be exercised with
// Postman or curl, exactly as Section 3.5 describes. Each handler calls
// the deployed chaincode through the Fabric Gateway client as the Org1
// Admin identity: state-changing calls are submitted (endorsed, ordered
// and committed before the handler responds) and reads are evaluated on
// the gateway peer only. The HTTP routes and JSON shapes are the same as
// the earlier MockLedger-backed version, so
// deployment/consentaccess.postman_collection.json works unchanged.
//
// Configuration (environment variables, all optional):
//
//	FABRIC_ORG1_DIR   Org1 crypto material; default
//	                  ~/fabric/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com
//	PEER_ENDPOINT     gateway peer address; default localhost:7051
//	GATEWAY_PEER      TLS server name of that peer; default peer0.org1.example.com
//	MSP_ID            default Org1MSP
//	CHANNEL_NAME      default mychannel
//	CHAINCODE_NAME    default consentaccess
//	TLS_CLIENT_CERT,  PEM client certificate and key; when both are set the
//	TLS_CLIENT_KEY    connection uses mutual TLS
//	LISTEN_ADDR       default :8080
package main

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	consentaccess "consentaccess"

	"github.com/hyperledger/fabric-gateway/pkg/client"
	"github.com/hyperledger/fabric-gateway/pkg/hash"
	"github.com/hyperledger/fabric-gateway/pkg/identity"
	"github.com/hyperledger/fabric-protos-go-apiv2/gateway"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/status"
)

var contract *client.Contract

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

// chaincodeError extracts the message a chaincode function returned when
// it rejected a call (e.g. "request does-not-exist not found"), so clients
// see the same errors the MockLedger-backed API returned rather than the
// gateway's wrapper text. ok is false when the call failed for any other
// reason, such as the peer being unreachable.
func chaincodeError(err error) (msg string, ok bool) {
	for _, d := range status.Convert(err).Details() {
		if detail, isDetail := d.(*gateway.ErrorDetail); isDetail && detail.GetMessage() != "" {
			m := detail.GetMessage()
			if i := strings.Index(m, ", "); strings.HasPrefix(m, "chaincode response") && i >= 0 {
				m = m[i+2:]
			}
			return m, true
		}
	}
	return "", false
}

// submit submits a transaction and waits for it to commit, like
// contract.SubmitTransaction, and also records the transaction ID and the
// block it was committed in: as an "X-Fabric-Tx" response header (one per
// transaction, so the JSON body is unchanged) and in the server log. This
// is the evidence that each call is a real ledger transaction.
func submit(w http.ResponseWriter, name string, args ...string) ([]byte, error) {
	result, commit, err := contract.SubmitAsync(name, client.WithArguments(args...))
	if err != nil {
		return nil, err
	}
	st, err := commit.Status()
	if err != nil {
		return nil, err
	}
	record := fmt.Sprintf("%s tx=%s block=%d status=%s", name, st.TransactionID, st.BlockNumber, st.Code)
	w.Header().Add("X-Fabric-Tx", record)
	log.Print(record)
	if !st.Successful {
		return nil, fmt.Errorf("transaction %s failed to commit with status %s", st.TransactionID, st.Code)
	}
	return result, nil
}

// writeFabricErr reports a chaincode rejection as 400, matching the
// MockLedger-backed API, and any other failure to reach or use the
// network as 502.
func writeFabricErr(w http.ResponseWriter, err error) {
	if msg, ok := chaincodeError(err); ok {
		writeErr(w, http.StatusBadRequest, errors.New(msg))
		return
	}
	log.Printf("fabric call failed: %v", err)
	writeErr(w, http.StatusBadGateway, err)
}

// POST /consent/grant  {patientId, providerId, scope, expiry}
func handleGrantConsent(w http.ResponseWriter, r *http.Request) {
	var req struct {
		PatientID  string    `json:"patientId"`
		ProviderID string    `json:"providerId"`
		Scope      string    `json:"scope"`
		Expiry     time.Time `json:"expiry"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	if _, err := submit(w, "GrantConsent", req.PatientID, req.ProviderID, req.Scope, req.Expiry.Format(time.RFC3339Nano)); err != nil {
		writeFabricErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "consent granted"})
}

// POST /consent/revoke  {patientId, providerId}
func handleRevokeConsent(w http.ResponseWriter, r *http.Request) {
	var req struct {
		PatientID  string `json:"patientId"`
		ProviderID string `json:"providerId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	if _, err := submit(w, "RevokeConsent", req.PatientID, req.ProviderID); err != nil {
		writeFabricErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "consent revoked"})
}

// POST /access/request  {requestId, providerId, patientId, recordReference}
func handleRequestAccess(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RequestID       string `json:"requestId"`
		ProviderID      string `json:"providerId"`
		PatientID       string `json:"patientId"`
		RecordReference string `json:"recordReference"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	if _, err := submit(w, "RequestAccess", req.RequestID, req.ProviderID, req.PatientID, req.RecordReference); err != nil {
		writeFabricErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "access requested"})
}

// POST /access/verify  {requestId}
//
// VerifyAndGrantAccess updates the request's status on the ledger, so it
// is submitted like the other state-changing calls. It and the following
// LogAccessEvent are separate transactions: submit waits for
// each to commit, so the log entry is only written once the verification
// outcome is final.
func handleVerifyAndGrantAccess(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RequestID string `json:"requestId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	resultJSON, err := submit(w, "VerifyAndGrantAccess", req.RequestID)
	if err != nil {
		writeFabricErr(w, err)
		return
	}
	var result consentaccess.VerifyResult
	if err := json.Unmarshal(resultJSON, &result); err != nil {
		writeErr(w, http.StatusBadGateway, fmt.Errorf("decoding chaincode response: %w", err))
		return
	}
	outcome := "DENIED"
	if result.Granted {
		outcome = "GRANTED"
	}
	if _, err := submit(w, "LogAccessEvent", req.RequestID, outcome); err != nil {
		if msg, ok := chaincodeError(err); ok {
			err = errors.New(msg)
		}
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"granted":         result.Granted,
		"recordReference": result.RecordReference,
		"outcome":         outcome,
	})
}

// GET /access/log?requestId=...
func handleGetLog(w http.ResponseWriter, r *http.Request) {
	requestID := r.URL.Query().Get("requestId")
	entryJSON, err := contract.EvaluateTransaction("GetLogEntry", requestID)
	if err != nil {
		if msg, ok := chaincodeError(err); ok {
			// Matches GetLogEntry's own not-found error, not other "not
			// found" errors such as the chaincode not being deployed.
			if strings.HasPrefix(msg, "log entry for request ") && strings.HasSuffix(msg, " not found") {
				writeErr(w, http.StatusNotFound, errNotFound)
				return
			}
			writeErr(w, http.StatusInternalServerError, errors.New(msg))
			return
		}
		writeFabricErr(w, err)
		return
	}
	var entry consentaccess.AccessLogEntry
	if err := json.Unmarshal(entryJSON, &entry); err != nil {
		writeErr(w, http.StatusBadGateway, fmt.Errorf("decoding chaincode response: %w", err))
		return
	}
	writeJSON(w, http.StatusOK, entry)
}

// routes lists the API's endpoints for the status reply at "/".
var routes = []string{
	"POST /consent/grant   {patientId, providerId, scope, expiry}",
	"POST /consent/revoke  {patientId, providerId}",
	"POST /access/request  {requestId, providerId, patientId, recordReference}",
	"POST /access/verify   {requestId}",
	"GET  /access/log?requestId=...",
}

// statusHandler serves GET / with what the API is connected to and whether
// the chaincode currently answers. The probe evaluates GetRequest for an
// empty ID: the chaincode rejects that with "not found", which shows the
// peer and chaincode are up without reading or writing any real record.
func statusHandler(channel, chaincode, peer, mspID string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		fabric := map[string]string{
			"channel":   channel,
			"chaincode": chaincode,
			"peer":      peer,
			"identity":  mspID + " Admin",
		}
		code, status := http.StatusOK, "ok"
		if _, err := contract.EvaluateTransaction("GetRequest", ""); err != nil {
			if _, ok := chaincodeError(err); !ok {
				code, status = http.StatusServiceUnavailable, "fabric unreachable"
				fabric["error"] = err.Error()
			}
		}
		writeJSON(w, code, map[string]interface{}{
			"service": "consentledger-api",
			"status":  status,
			"fabric":  fabric,
			"routes":  routes,
		})
	}
}

var errNotFound = &notFoundError{}

type notFoundError struct{}

func (e *notFoundError) Error() string { return "log entry not found" }

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// readFirstFile returns the contents of the only file in dir, which is how
// Fabric's MSP folders store a user's certificate and private key.
func readFirstFile(dir string) ([]byte, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	for _, e := range entries {
		if !e.IsDir() {
			return os.ReadFile(filepath.Join(dir, e.Name()))
		}
	}
	return nil, fmt.Errorf("no file found in %s", dir)
}

func newGrpcConnection(orgDir, peerEndpoint, gatewayPeer string) (*grpc.ClientConn, error) {
	caPEM, err := os.ReadFile(filepath.Join(orgDir, "peers", gatewayPeer, "tls", "ca.crt"))
	if err != nil {
		return nil, fmt.Errorf("reading peer TLS CA certificate: %w", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(caPEM) {
		return nil, errors.New("peer TLS CA certificate is not valid PEM")
	}
	tlsConfig := &tls.Config{RootCAs: pool, ServerName: gatewayPeer, MinVersion: tls.VersionTLS12}

	certPath, keyPath := os.Getenv("TLS_CLIENT_CERT"), os.Getenv("TLS_CLIENT_KEY")
	if certPath != "" && keyPath != "" {
		clientCert, err := tls.LoadX509KeyPair(certPath, keyPath)
		if err != nil {
			return nil, fmt.Errorf("loading TLS client certificate: %w", err)
		}
		tlsConfig.Certificates = []tls.Certificate{clientCert}
		log.Printf("using mutual TLS with client certificate %s", certPath)
	}

	return grpc.NewClient(peerEndpoint, grpc.WithTransportCredentials(credentials.NewTLS(tlsConfig)))
}

func newIdentityAndSign(orgDir, mspID string) (*identity.X509Identity, identity.Sign, error) {
	mspDir := filepath.Join(orgDir, "users", "Admin@"+filepath.Base(orgDir), "msp")

	certPEM, err := readFirstFile(filepath.Join(mspDir, "signcerts"))
	if err != nil {
		return nil, nil, fmt.Errorf("reading Admin certificate: %w", err)
	}
	cert, err := identity.CertificateFromPEM(certPEM)
	if err != nil {
		return nil, nil, err
	}
	id, err := identity.NewX509Identity(mspID, cert)
	if err != nil {
		return nil, nil, err
	}

	keyPEM, err := readFirstFile(filepath.Join(mspDir, "keystore"))
	if err != nil {
		return nil, nil, fmt.Errorf("reading Admin private key: %w", err)
	}
	key, err := identity.PrivateKeyFromPEM(keyPEM)
	if err != nil {
		return nil, nil, err
	}
	sign, err := identity.NewPrivateKeySign(key)
	if err != nil {
		return nil, nil, err
	}
	return id, sign, nil
}

func main() {
	home, _ := os.UserHomeDir()
	orgDir := envOr("FABRIC_ORG1_DIR", filepath.Join(home, "fabric", "fabric-samples", "test-network", "organizations", "peerOrganizations", "org1.example.com"))
	peerEndpoint := envOr("PEER_ENDPOINT", "localhost:7051")
	gatewayPeer := envOr("GATEWAY_PEER", "peer0.org1.example.com")
	mspID := envOr("MSP_ID", "Org1MSP")
	channelName := envOr("CHANNEL_NAME", "mychannel")
	chaincodeName := envOr("CHAINCODE_NAME", "consentaccess")
	addr := envOr("LISTEN_ADDR", ":8080")

	conn, err := newGrpcConnection(orgDir, peerEndpoint, gatewayPeer)
	if err != nil {
		log.Fatalf("connecting to gateway peer: %v", err)
	}
	defer conn.Close()

	id, sign, err := newIdentityAndSign(orgDir, mspID)
	if err != nil {
		log.Fatalf("loading Org1 Admin identity: %v", err)
	}

	gw, err := client.Connect(
		id,
		client.WithSign(sign),
		client.WithHash(hash.SHA256),
		client.WithClientConnection(conn),
		client.WithEvaluateTimeout(5*time.Second),
		client.WithEndorseTimeout(15*time.Second),
		client.WithSubmitTimeout(5*time.Second),
		client.WithCommitStatusTimeout(1*time.Minute),
	)
	if err != nil {
		log.Fatalf("connecting to Fabric Gateway: %v", err)
	}
	defer gw.Close()

	contract = gw.GetNetwork(channelName).GetContract(chaincodeName)

	mux := http.NewServeMux()
	mux.HandleFunc("/consent/grant", handleGrantConsent)
	mux.HandleFunc("/consent/revoke", handleRevokeConsent)
	mux.HandleFunc("/access/request", handleRequestAccess)
	mux.HandleFunc("/access/verify", handleVerifyAndGrantAccess)
	mux.HandleFunc("/access/log", handleGetLog)
	// "{$}" matches "/" exactly, so other unknown paths still return 404.
	mux.HandleFunc("GET /{$}", statusHandler(channelName, chaincodeName, peerEndpoint, mspID))

	log.Printf("consent-access API listening on %s (chaincode %s on channel %s via %s as %s Admin)",
		addr, chaincodeName, channelName, peerEndpoint, mspID)
	log.Fatal(http.ListenAndServe(addr, mux))
}
