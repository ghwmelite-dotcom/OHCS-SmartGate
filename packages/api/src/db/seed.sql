-- Seed: OHCS Directorates
INSERT OR IGNORE INTO directorates (id, name, abbreviation, floor, wing) VALUES
('dir_rsimd', 'Research, Statistics & Information Management Directorate', 'RSIMD', '2nd Floor', 'East'),
('dir_hrmd', 'Human Resource Management Directorate', 'HRMD', '1st Floor', 'West'),
('dir_ppmed', 'Policy, Planning, Monitoring & Evaluation Directorate', 'PPMED', '3rd Floor', 'East'),
('dir_fad', 'Finance & Administration Directorate', 'FAD', '1st Floor', 'East'),
('dir_cstd', 'Civil Service Training Directorate', 'CSTD', '2nd Floor', 'West'),
('dir_lgs', 'Local Government Service Secretariat', 'LGS', '3rd Floor', 'West'),
('dir_psc', 'Public Services Commission', 'PSC', 'Ground Floor', 'East'),
('dir_ohcs', 'Office of the Head of Civil Service', 'OHCS', '4th Floor', 'Main'),
('dir_ocd', 'Office of the Chief Director', 'OCD', '4th Floor', 'Main');

-- Seed: Visit Categories
INSERT OR IGNORE INTO visit_categories (id, name, slug, directorate_hint_id) VALUES
('cat_meeting', 'Official Meeting', 'official_meeting', NULL),
('cat_docsub', 'Document Submission', 'document_submission', NULL),
('cat_job', 'Job Inquiry / Application', 'job_inquiry', 'dir_hrmd'),
('cat_complaint', 'Complaint / Petition', 'complaint', NULL),
('cat_personal', 'Personal Visit', 'personal_visit', NULL),
('cat_delivery', 'Delivery / Collection', 'delivery', 'dir_fad'),
('cat_appt', 'Scheduled Appointment', 'scheduled_appointment', NULL),
('cat_consult', 'Consultation / Advisory', 'consultation', NULL),
('cat_inspect', 'Inspection / Audit', 'inspection', NULL),
('cat_training', 'Training / Workshop', 'training', 'dir_cstd'),
('cat_interview', 'Interview', 'interview', 'dir_hrmd'),
('cat_other', 'Other', 'other', NULL);

-- Seed: Default admin user (receptionist)
INSERT OR IGNORE INTO users (id, name, email, role) VALUES
('user_admin', 'OHCS Reception', 'reception@ohcs.gov.gh', 'admin');

-- Seed: Sample officers
INSERT OR IGNORE INTO officers (id, name, title, directorate_id, email, office_number) VALUES
('off_mensah', 'Mr. Kwabena Mensah', 'Director', 'dir_rsimd', 'k.mensah@ohcs.gov.gh', 'R201'),
('off_addo', 'Mrs. Abena Addo', 'Deputy Director', 'dir_hrmd', 'a.addo@ohcs.gov.gh', 'H102'),
('off_owusu', 'Mr. Yaw Owusu', 'Principal Officer', 'dir_fad', 'y.owusu@ohcs.gov.gh', 'F105'),
('off_boateng', 'Ms. Akosua Boateng', 'Senior Officer', 'dir_ppmed', 'a.boateng@ohcs.gov.gh', 'P301'),
('off_asante', 'Mr. Kofi Asante', 'Chief Director', 'dir_ocd', 'k.asante@ohcs.gov.gh', 'CD401');
