-- Application accounts and sessions for the web app and REST API.
-- Load after postgres_schema.sql and postgres_seed.sql.
--
-- Passwords are hashed with bcrypt by pgcrypto's crypt()/gen_salt('bf');
-- the API checks them with password_hash = crypt(<given>, password_hash),
-- so plaintext passwords never leave PostgreSQL's hashing function.
-- Sessions store only the SHA-256 of each token, so a leaked sessions
-- table does not let anyone sign in.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE app_users (
    user_id         TEXT PRIMARY KEY,
    username        TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    role            TEXT NOT NULL CHECK (role IN ('patient', 'provider', 'regulator')),
    patient_id      TEXT REFERENCES patients(patient_id),
    provider_id     TEXT REFERENCES providers(provider_id),
    display_name    TEXT NOT NULL,
    email           TEXT,
    phone           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- A patient account acts for exactly one patient; provider and
    -- regulator accounts act for exactly one organisation.
    CHECK ((role = 'patient') = (patient_id IS NOT NULL)),
    CHECK ((role IN ('provider', 'regulator')) = (provider_id IS NOT NULL))
);

CREATE TABLE app_sessions (
    token_hash      TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_app_sessions_user ON app_sessions(user_id);

-- Demo accounts for the walkthrough (synthetic, Section 1.4). They share
-- one demo password, ConsentDemo2026; give it to participants on the task
-- sheet, and change it with the app's "Change password" setting if the
-- prototype is ever exposed beyond a local machine.
INSERT INTO app_users (user_id, username, password_hash, role, patient_id, provider_id, display_name, email, phone)
SELECT u.user_id, u.username, crypt('ConsentDemo2026', gen_salt('bf', 10)), u.role, u.patient_id, u.provider_id,
       u.display_name, u.email, u.phone
FROM (VALUES
    ('u-patient-001', 'adaeze.okafor',  'patient',   'patient-001', NULL,               'Adaeze Okafor',                 'adaeze.okafor@example.test',  '+234 800 000 0001'),
    ('u-patient-002', 'tunde.adeyemi',  'patient',   'patient-002', NULL,               'Tunde Adeyemi',                 'tunde.adeyemi@example.test',  '+234 800 000 0002'),
    ('u-patient-003', 'amina.bello',    'patient',   'patient-003', NULL,               'Amina Bello',                   'amina.bello@example.test',    '+234 800 000 0003'),
    ('u-patient-004', 'chinedu.eze',    'patient',   'patient-004', NULL,               'Chinedu Eze',                   'chinedu.eze@example.test',    '+234 800 000 0004'),
    ('u-patient-005', 'fatima.yusuf',   'patient',   'patient-005', NULL,               'Fatima Yusuf',                  'fatima.yusuf@example.test',   '+234 800 000 0005'),
    ('u-hosp-a',      'hospital.a',     'provider',  NULL,          'provider-hosp-A',  'Records Officer, Hospital A',   'records@hospital-a.example.test', '+234 800 100 0001'),
    ('u-lab-b',       'lab.b',          'provider',  NULL,          'provider-lab-B',   'Lab Scientist, Laboratory B',   'lab@laboratory-b.example.test',   '+234 800 100 0002'),
    ('u-pharm-c',     'pharmacy.c',     'provider',  NULL,          'provider-pharm-C', 'Pharmacist, Pharmacy C',        'pharmacy@pharmacy-c.example.test', '+234 800 100 0003'),
    ('u-ins-d',       'insurer.d',      'provider',  NULL,          'provider-ins-D',   'Claims Officer, Insurer D',     'claims@insurer-d.example.test',   '+234 800 100 0004'),
    ('u-reg-e',       'regulator.e',    'regulator', NULL,          'provider-reg-E',   'Compliance Auditor, Regulator E', 'audit@regulator-e.example.test', '+234 800 100 0005')
) AS u(user_id, username, role, patient_id, provider_id, display_name, email, phone);
