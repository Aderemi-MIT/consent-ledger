-- Off-chain data layer (Section 3.4.4). Holds the simulated EHR/EMR
-- records referenced — never stored — on the blockchain. The blockchain
-- keeps only the record_reference and a content hash sufficient to prove
-- later which version of a record was accessed; the clinical content
-- itself always lives here, in a conventional relational database.

CREATE TABLE patients (
    patient_id      TEXT PRIMARY KEY,
    display_name    TEXT NOT NULL,   -- synthetic/test data only — Section 1.4
    date_of_birth   DATE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE providers (
    provider_id     TEXT PRIMARY KEY,
    organization    TEXT NOT NULL,
    provider_type   TEXT NOT NULL CHECK (provider_type IN ('hospital', 'laboratory', 'pharmacy', 'insurer', 'regulator')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE clinical_records (
    record_reference    TEXT PRIMARY KEY,   -- the identifier the chaincode's
                                             -- RequestAccess/VerifyAndGrantAccess
                                             -- functions operate on
    patient_id          TEXT NOT NULL REFERENCES patients(patient_id),
    record_type         TEXT NOT NULL,      -- e.g. 'lab-result', 'prescription', 'clinical-note'
    content              JSONB NOT NULL,     -- synthetic clinical content only
    content_hash         TEXT NOT NULL,      -- SHA-256 (lowercase hex) of
                                              -- content::text, PostgreSQL's canonical
                                              -- JSONB text form. Mirrored on-chain by
                                              -- RequestAccess (AccessRequest.contentHash)
                                              -- so a later access can be proven to
                                              -- match this exact version
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_clinical_records_patient ON clinical_records(patient_id);

COMMENT ON TABLE clinical_records IS
  'Synthetic test data only. No real patient information is stored in this prototype (Section 1.4 / 3.8).';
