-- Synthetic seed data for the off-chain data layer (Section 1.4 / 3.4.4).
-- Every name, organization and clinical value below is invented for the
-- prototype; none of it describes a real person or facility.
--
-- content_hash is the SHA-256 (lowercase hex) of the record's content in
-- PostgreSQL's canonical JSONB text form, content::text. The API computes
-- the hash the same way when a provider requests a record, records it on
-- the ledger with RequestAccess, and recomputes it before releasing the
-- record, so any later change to the content is detected.

INSERT INTO patients (patient_id, display_name, date_of_birth) VALUES
    ('patient-001', 'Adaeze Okafor (synthetic)',  '1988-03-14'),
    ('patient-002', 'Tunde Adeyemi (synthetic)',  '1975-11-02'),
    ('patient-003', 'Amina Bello (synthetic)',    '1993-07-21'),
    ('patient-004', 'Chinedu Eze (synthetic)',    '1961-01-30'),
    ('patient-005', 'Fatima Yusuf (synthetic)',   '2001-09-08');

INSERT INTO providers (provider_id, organization, provider_type) VALUES
    ('provider-hosp-A',  'Demo General Hospital A',       'hospital'),
    ('provider-lab-B',   'Demo Diagnostics Laboratory B', 'laboratory'),
    ('provider-pharm-C', 'Demo Community Pharmacy C',     'pharmacy'),
    ('provider-ins-D',   'Demo Health Insurer D',         'insurer'),
    ('provider-reg-E',   'Demo Health Regulator E',       'regulator');

WITH seed (record_reference, patient_id, record_type, content) AS (VALUES
    ('ehr-ref-55A', 'patient-002', 'lab-result',
     '{"test": "Full blood count", "collected": "2026-09-12", "results": {"haemoglobin_g_dl": 13.8, "wbc_10e9_l": 6.2, "platelets_10e9_l": 245}, "flag": "within reference range", "issued_by": "provider-lab-B"}'),
    ('ehr-ref-55B', 'patient-002', 'prescription',
     '{"medication": "Amlodipine", "dose": "5 mg", "frequency": "once daily", "duration_days": 30, "prescribed": "2026-09-15", "prescriber": "provider-hosp-A"}'),
    ('ehr-ref-55C', 'patient-002', 'clinical-note',
     '{"visit": "2026-09-15", "complaint": "Routine hypertension review", "blood_pressure": "138/86", "plan": "Continue current medication; review in 3 months", "author": "provider-hosp-A"}'),
    ('ehr-ref-11A', 'patient-001', 'lab-result',
     '{"test": "Fasting blood glucose", "collected": "2026-08-30", "results": {"glucose_mmol_l": 5.1}, "flag": "within reference range", "issued_by": "provider-lab-B"}'),
    ('ehr-ref-11B', 'patient-001', 'clinical-note',
     '{"visit": "2026-09-02", "complaint": "Antenatal check, 24 weeks", "blood_pressure": "112/70", "plan": "Routine follow-up in 4 weeks", "author": "provider-hosp-A"}'),
    ('ehr-ref-33A', 'patient-003', 'lab-result',
     '{"test": "Malaria rapid diagnostic test", "collected": "2026-09-20", "results": {"p_falciparum": "positive"}, "flag": "abnormal", "issued_by": "provider-lab-B"}'),
    ('ehr-ref-33B', 'patient-003', 'prescription',
     '{"medication": "Artemether-lumefantrine", "dose": "80/480 mg", "frequency": "twice daily", "duration_days": 3, "prescribed": "2026-09-20", "prescriber": "provider-hosp-A"}'),
    ('ehr-ref-44A', 'patient-004', 'imaging-report',
     '{"study": "Chest X-ray, PA view", "performed": "2026-09-05", "findings": "No focal consolidation; heart size normal", "impression": "Normal study", "reported_by": "provider-hosp-A"}'),
    ('ehr-ref-55D', 'patient-005', 'lab-result',
     '{"test": "Lipid profile", "collected": "2026-09-25", "results": {"total_cholesterol_mmol_l": 4.6, "ldl_mmol_l": 2.7, "hdl_mmol_l": 1.3}, "flag": "within reference range", "issued_by": "provider-lab-B"}')
)
INSERT INTO clinical_records (record_reference, patient_id, record_type, content, content_hash)
SELECT record_reference, patient_id, record_type, content::jsonb,
       encode(sha256(convert_to(content::jsonb::text, 'UTF8')), 'hex')
FROM seed;
