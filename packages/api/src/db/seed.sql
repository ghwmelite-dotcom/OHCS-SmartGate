-- Seed: OHCS Org Entities (from real OHCS structure)
-- Directorates
INSERT OR IGNORE INTO directorates (id, name, abbreviation, type, rooms) VALUES
('dir_cmd', 'Career Management Directorate', 'CMD', 'directorate', '33, 34'),
('dir_fa', 'Finance & Administration', 'F&A', 'directorate', '02, 03, 04, 35, 38, 39, 49, 51, 52, 54'),
('dir_pbmed', 'Planning, Budgeting, Monitoring & Evaluation Directorate', 'PBMED', 'directorate', '31, 32'),
('dir_rtdd', 'Recruitment, Training & Development Directorate', 'RTDD', 'directorate', '09, 11, 12, 48'),
('dir_rsimd', 'Research, Statistics & Information Management Directorate', 'RSIMD', 'directorate', '19, 21');

-- Secretariats
INSERT OR IGNORE INTO directorates (id, name, abbreviation, type, rooms) VALUES
('dir_cdsec', 'Chief Director''s Secretariat', 'CD-SEC', 'secretariat', '24, 44');

-- Units
INSERT OR IGNORE INTO directorates (id, name, abbreviation, type, rooms) VALUES
('dir_accounts', 'Accounts', 'ACCOUNTS', 'unit', NULL),
('dir_csc', 'Civil Service Council', 'CSC', 'unit', '24, 44'),
('dir_estate', 'Estate', 'ESTATE', 'unit', NULL),
('dir_iau', 'Internal Audit Unit', 'IAU', 'unit', NULL),
('dir_rcu', 'Reform Coordinating Unit', 'RCU', 'unit', NULL);

-- Seed: Visit Categories
INSERT OR IGNORE INTO visit_categories (id, name, slug, directorate_hint_id) VALUES
('cat_meeting', 'Official Meeting', 'official_meeting', NULL),
('cat_docsub', 'Document Submission', 'document_submission', NULL),
('cat_job', 'Job Inquiry / Application', 'job_inquiry', 'dir_rtdd'),
('cat_complaint', 'Complaint / Petition', 'complaint', NULL),
('cat_personal', 'Personal Visit', 'personal_visit', NULL),
('cat_delivery', 'Delivery / Collection', 'delivery', 'dir_fa'),
('cat_appt', 'Scheduled Appointment', 'scheduled_appointment', NULL),
('cat_consult', 'Consultation / Advisory', 'consultation', NULL),
('cat_inspect', 'Inspection / Audit', 'inspection', NULL),
('cat_training', 'Training / Workshop', 'training', 'dir_rtdd'),
('cat_interview', 'Interview', 'interview', 'dir_rtdd'),
('cat_other', 'Other', 'other', NULL);

-- Seed: Default admin user (receptionist)
-- Default PIN: 1234 (SHA-256: 03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4)
INSERT OR IGNORE INTO users (id, name, email, staff_id, pin_hash, role) VALUES
('user_admin', 'OHCS Reception', 'reception@ohcs.gov.gh', 'OHCS-001', '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4', 'admin');

-- Seed: Sample officers (mapped to real directorates)
INSERT OR IGNORE INTO officers (id, name, title, directorate_id, email, office_number) VALUES
('off_mensah', 'Mr. Kwabena Mensah', 'Director', 'dir_rsimd', 'k.mensah@ohcs.gov.gh', 'Room 19'),
('off_addo', 'Mrs. Abena Addo', 'Director', 'dir_rtdd', 'a.addo@ohcs.gov.gh', 'Room 09'),
('off_owusu', 'Mr. Yaw Owusu', 'Principal Officer', 'dir_fa', 'y.owusu@ohcs.gov.gh', 'Room 02'),
('off_boateng', 'Ms. Akosua Boateng', 'Senior Officer', 'dir_pbmed', 'a.boateng@ohcs.gov.gh', 'Room 31'),
('off_asante', 'Mr. Kofi Asante', 'Chief Director', 'dir_cdsec', 'k.asante@ohcs.gov.gh', 'Room 24');
