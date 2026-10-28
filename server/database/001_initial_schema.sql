CREATE DATABASE IF NOT EXISTS student_information_system
  CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
USE student_information_system;

CREATE TABLE IF NOT EXISTS users (
  id INT NOT NULL AUTO_INCREMENT,
  user_id VARCHAR(30) NOT NULL,
  password VARCHAR(255) NOT NULL,
  email VARCHAR(100) NOT NULL,
  role ENUM('admin', 'teacher', 'student') NOT NULL,
  is_default_password TINYINT(1) NOT NULL DEFAULT 1,
  reset_otp VARCHAR(6) DEFAULT NULL,
  reset_otp_expires DATETIME DEFAULT NULL,
  status ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
  full_name VARCHAR(100) DEFAULT NULL,
  subject_code VARCHAR(50) DEFAULT NULL,
  profile_picture LONGTEXT DEFAULT NULL,
  approval_status VARCHAR(50) DEFAULT 'pending',
  pending_email VARCHAR(100) DEFAULT NULL,
  email_change_otp VARCHAR(6) DEFAULT NULL,
  email_change_expires DATETIME DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  admin_id VARCHAR(30) DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY user_id (user_id),
  UNIQUE KEY unique_email (email),
  UNIQUE KEY admin_id (admin_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS teachers (
  id INT NOT NULL AUTO_INCREMENT,
  user_account_id INT DEFAULT NULL,
  teacher_id VARCHAR(30) NOT NULL,
  first_name VARCHAR(50) NOT NULL,
  middle_name VARCHAR(50) DEFAULT NULL,
  last_name VARCHAR(50) NOT NULL,
  email VARCHAR(100) NOT NULL,
  phone_number VARCHAR(20) DEFAULT NULL,
  profile_picture LONGTEXT DEFAULT NULL,
  department VARCHAR(100) DEFAULT NULL,
  status ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reset_otp VARCHAR(10) DEFAULT NULL,
  reset_otp_expires DATETIME DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY teacher_id (teacher_id),
  UNIQUE KEY teacher_email (email),
  KEY fk_teacher_user (user_account_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS students (
  id INT NOT NULL AUTO_INCREMENT,
  user_account_id INT DEFAULT NULL,
  teacher_id VARCHAR(30) DEFAULT NULL,
  student_no VARCHAR(30) NOT NULL,
  department VARCHAR(255) NOT NULL DEFAULT '',
  course VARCHAR(50) NOT NULL,
  first_name VARCHAR(50) NOT NULL,
  last_name VARCHAR(50) NOT NULL,
  year_level VARCHAR(20) DEFAULT NULL,
  gender VARCHAR(20) DEFAULT NULL,
  day VARCHAR(20) DEFAULT NULL,
  class_time VARCHAR(50) DEFAULT NULL,
  time_period ENUM('AM', 'PM') DEFAULT 'AM',
  birthday DATE DEFAULT NULL,
  address VARCHAR(255) DEFAULT NULL,
  contact_number VARCHAR(20) DEFAULT NULL,
  emergency_contact_number VARCHAR(20) DEFAULT NULL,
  status ENUM('Active', 'Dropped', 'Graduated', 'Shifted', 'Inactive') NOT NULL DEFAULT 'Active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY student_no (student_no),
  KEY fk_student_user (user_account_id),
  KEY fk_student_teacher (teacher_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS class_schedules (
  id INT NOT NULL AUTO_INCREMENT,
  teacher_id VARCHAR(255) NOT NULL DEFAULT '',
  subject VARCHAR(150) NOT NULL,
  section_course VARCHAR(100) NOT NULL,
  department VARCHAR(255) NOT NULL DEFAULT '',
  course VARCHAR(255) NOT NULL DEFAULT '',
  professor_name VARCHAR(255) NOT NULL DEFAULT '',
  room_lab VARCHAR(100) DEFAULT NULL,
  day VARCHAR(20) NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS class_list_schedules (
  id INT NOT NULL AUTO_INCREMENT,
  subject VARCHAR(255) NOT NULL,
  section_course VARCHAR(255) NOT NULL,
  department VARCHAR(255) NOT NULL DEFAULT '',
  course VARCHAR(255) NOT NULL DEFAULT '',
  day VARCHAR(30) NOT NULL,
  class_time VARCHAR(60) NOT NULL DEFAULT '',
  teacher_id VARCHAR(255) NOT NULL DEFAULT '',
  professor_name VARCHAR(255) NOT NULL DEFAULT '',
  source_schedule_id INT DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY source_schedule_id (source_schedule_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS class_list_students (
  class_list_schedule_id INT NOT NULL,
  student_id INT NOT NULL,
  PRIMARY KEY (class_list_schedule_id, student_id),
  KEY fk_class_list_schedule (class_list_schedule_id),
  KEY fk_class_list_student (student_id)
) ENGINE=InnoDB;

-- Optional display name for a department/course group. This is cosmetic only:
-- the stored department and course always remain the BSIT values.
CREATE TABLE IF NOT EXISTS class_list_group_labels (
  id INT NOT NULL AUTO_INCREMENT,
  department VARCHAR(255) NOT NULL,
  course VARCHAR(255) NOT NULL,
  display_label VARCHAR(255) NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY group_key (department, course)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS schedule_student_assignments (
  id INT NOT NULL AUTO_INCREMENT,
  schedule_id INT NOT NULL,
  student_id INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY unique_schedule_student (schedule_id, student_id),
  KEY fk_assignment_schedule (schedule_id),
  KEY fk_assignment_student (student_id)
) ENGINE=InnoDB;

