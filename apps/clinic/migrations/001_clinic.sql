-- clinic: a clinic network site — clinics (each with a pharmacy), doctors,
-- insurance plans and their coverage, medications and pharmacy prices,
-- patients, appointments, prescriptions and refill requests. Every tenant
-- table is scoped by workspace_id and cascades from core.workspaces.
CREATE SCHEMA IF NOT EXISTS clinic;

CREATE TABLE IF NOT EXISTS clinic.users (
  workspace_id   TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  email          TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  display_name   TEXT NOT NULL,
  verified_at    TIMESTAMPTZ,
  api_token      TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, email)
);
CREATE UNIQUE INDEX IF NOT EXISTS cl_users_api_token ON clinic.users (workspace_id, api_token) WHERE api_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS clinic.verification_codes (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  code         TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (workspace_id, email)
);

CREATE TABLE IF NOT EXISTS clinic.sessions (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  token        TEXT NOT NULL,
  email        TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (workspace_id, token)
);

CREATE TABLE IF NOT EXISTS clinic.clinics (
  workspace_id    TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  city            TEXT NOT NULL,
  address         TEXT NOT NULL,
  phone           TEXT NOT NULL,
  pharmacy_phone  TEXT NOT NULL,
  PRIMARY KEY (workspace_id, code)
);

CREATE TABLE IF NOT EXISTS clinic.plans (
  workspace_id           TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  code                   TEXT NOT NULL,
  name                   TEXT NOT NULL,
  in_person_copay_cents  INTEGER NOT NULL,
  video_copay_cents      INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, code)
);

CREATE TABLE IF NOT EXISTS clinic.doctors (
  workspace_id            TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  code                    TEXT NOT NULL,
  name                    TEXT NOT NULL,
  clinic_code             TEXT NOT NULL,
  specialty               TEXT NOT NULL,
  languages               TEXT[] NOT NULL,
  visit_types             TEXT[] NOT NULL,
  accepting_new_patients  BOOLEAN NOT NULL,
  network_plans           TEXT[] NOT NULL,
  in_person_fee_cents     INTEGER,
  video_fee_cents         INTEGER,
  work_days               INTEGER[] NOT NULL,
  session                 TEXT NOT NULL CHECK (session IN ('morning', 'afternoon')),
  PRIMARY KEY (workspace_id, code),
  FOREIGN KEY (workspace_id, clinic_code) REFERENCES clinic.clinics (workspace_id, code) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS clinic.procedures (
  workspace_id  TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  code          TEXT NOT NULL,
  name          TEXT NOT NULL,
  price_cents   INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, code)
);

CREATE TABLE IF NOT EXISTS clinic.coverage (
  workspace_id     TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  plan_code        TEXT NOT NULL,
  procedure_code   TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('covered', 'prior-authorisation', 'not-covered')),
  coinsurance_pct  INTEGER,
  PRIMARY KEY (workspace_id, plan_code, procedure_code),
  FOREIGN KEY (workspace_id, plan_code) REFERENCES clinic.plans (workspace_id, code) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, procedure_code) REFERENCES clinic.procedures (workspace_id, code) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS clinic.medications (
  workspace_id  TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  code          TEXT NOT NULL,
  name          TEXT NOT NULL,
  dosages       TEXT[] NOT NULL,
  PRIMARY KEY (workspace_id, code)
);

CREATE TABLE IF NOT EXISTS clinic.prices (
  workspace_id     TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  clinic_code      TEXT NOT NULL,
  medication_code  TEXT NOT NULL,
  dosage           TEXT NOT NULL,
  price_cents      INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, clinic_code, medication_code, dosage),
  FOREIGN KEY (workspace_id, clinic_code) REFERENCES clinic.clinics (workspace_id, code) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, medication_code) REFERENCES clinic.medications (workspace_id, code) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS clinic.patients (
  workspace_id  TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  name          TEXT NOT NULL,
  plan_code     TEXT NOT NULL,
  PRIMARY KEY (workspace_id, email)
);

CREATE TABLE IF NOT EXISTS clinic.appointments (
  workspace_id    TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  appointment_no  TEXT NOT NULL,
  doctor_code     TEXT NOT NULL,
  clinic_code     TEXT NOT NULL,
  patient_name    TEXT NOT NULL,
  patient_email   TEXT NOT NULL,
  plan_code       TEXT,
  date            DATE NOT NULL,
  time            TEXT NOT NULL,
  visit_type      TEXT NOT NULL CHECK (visit_type IN ('in-person', 'video')),
  status          TEXT NOT NULL CHECK (status IN ('booked', 'cancelled')),
  cost_cents      INTEGER NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at    TIMESTAMPTZ,
  PRIMARY KEY (workspace_id, appointment_no),
  FOREIGN KEY (workspace_id, doctor_code) REFERENCES clinic.doctors (workspace_id, code) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS cl_appointments_patient ON clinic.appointments (workspace_id, lower(patient_email));
CREATE INDEX IF NOT EXISTS cl_appointments_doctor ON clinic.appointments (workspace_id, doctor_code, date);
-- The rules refuse both inside the booking transaction; these make a race between two writers impossible too.
CREATE UNIQUE INDEX IF NOT EXISTS cl_appointments_slot ON clinic.appointments (workspace_id, doctor_code, date, time) WHERE status = 'booked';
CREATE UNIQUE INDEX IF NOT EXISTS cl_appointments_patient_slot ON clinic.appointments (workspace_id, lower(patient_email), date, time) WHERE status = 'booked';

CREATE TABLE IF NOT EXISTS clinic.prescriptions (
  workspace_id     TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  rx_no            TEXT NOT NULL,
  patient_email    TEXT NOT NULL,
  patient_name     TEXT NOT NULL,
  medication_code  TEXT NOT NULL,
  dosage           TEXT NOT NULL,
  doctor_code      TEXT NOT NULL,
  refills_left     INTEGER NOT NULL CHECK (refills_left >= 0),
  issued_on        DATE NOT NULL,
  PRIMARY KEY (workspace_id, rx_no),
  FOREIGN KEY (workspace_id, medication_code) REFERENCES clinic.medications (workspace_id, code) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS cl_prescriptions_patient ON clinic.prescriptions (workspace_id, lower(patient_email));

CREATE TABLE IF NOT EXISTS clinic.refills (
  workspace_id   TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  refill_no      TEXT NOT NULL,
  rx_no          TEXT NOT NULL,
  pharmacy_code  TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('requested', 'collected')),
  requested_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, refill_no),
  FOREIGN KEY (workspace_id, rx_no) REFERENCES clinic.prescriptions (workspace_id, rx_no) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS cl_refills_open ON clinic.refills (workspace_id, rx_no) WHERE status = 'requested';

CREATE TABLE IF NOT EXISTS clinic.counters (
  workspace_id TEXT NOT NULL REFERENCES core.workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  value        INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, name)
);
