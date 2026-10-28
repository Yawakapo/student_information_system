#ifndef SIS_STUDENT_TEXT_H
#define SIS_STUDENT_TEXT_H

typedef struct {
    char student_no[31];
    char first_name[51];
    char last_name[51];
    char year_level[21];
    char gender[21];
    char birthday[21];
    char address[256];
    char contact_number[21];
    char emergency_contact[21];
    char course[51];
} Student;

#define BSIT_COURSE "BSIT"
#define BSIT_DEPARTMENT "School of Information Technology"

typedef struct {
    int room;
    char *too_long_message;
} StudentField;


static int student_field_count = 10;

static int student_required_count = 9;

static char *student_number_taken_message =
    "A student with this student number already exists.";


static char *student_empty_words[9] = {
    "Student number", "First name", "Last name", "Year level",
    "Gender", "Birthday", "Address", "Contact number", "Emergency contact number"
};


static char *student_long_messages[10] = {
    "The student number is longer than the column allows.",
    "The first name is longer than the column allows.",
    "The last name is longer than the column allows.",
    "The year level is longer than the column allows.",
    "The gender is longer than the column allows.",
    "The birthday is longer than the column allows.",
    "The address is longer than the column allows.",
    "The contact number is longer than the column allows.",
    "The emergency contact number is longer than the column allows.",
    "The course is longer than the column allows."
};

/* The field a number refers to. The rooms match the fields above. */
static int student_field_room[10] = { 31, 51, 51, 21, 21, 21, 256, 21, 21, 51 };

/* Returns the box for a field number. One if and else per field, because a
   switch or an array of pointers would need something harder to explain. */
static char *student_box(Student *s, int field) {
    if (field == 0) return s->student_no;
    if (field == 1) return s->first_name;
    if (field == 2) return s->last_name;
    if (field == 3) return s->year_level;
    if (field == 4) return s->gender;
    if (field == 5) return s->birthday;
    if (field == 6) return s->address;
    if (field == 7) return s->contact_number;
    if (field == 8) return s->emergency_contact;
    return s->course;
}


static char *student_empty_field(Student *s) {
    int field = 0;
    
    while (field < 9) {
        if (student_box(s, field)[0] == '\0') {
            return student_empty_words[field];
        }
        field++;
    }
    return NULL;
}


static char *student_course_problem(Student *s) {
    char *course = s->course;
    if (course[0] == '\0') return NULL;
   
    if (course[0] == 'B') {
        if (course[1] == 'S') {
            if (course[2] == 'I') {
                if (course[3] == 'T') {
                    if (course[4] == '\0') return NULL;
                }
            }
        }
    }
    return "Only BSIT students are allowed in this system.";
}


static int copy_field(char *box, char *value, int room) {
    int used = 0;
    if (value == NULL) value = "";
   
    value = strchr(value, '=');
    if (value != NULL) value = value + 1;
    else value = "";
    while (value[used] != '\0') used++;
    copy_text_bounded(box, value, room);
    
    if (used > room - 1) return 1;
    return 0;
}


static char *student_too_long(Student *s, char *argv[], int first, int count) {
    int field = 0;
    char *problem = NULL;
    while (field < count) {
        int fitted = copy_field(student_box(s, field), argv[first + field], student_field_room[field]);
        if (fitted == 1) {
            if (problem == NULL) problem = student_long_messages[field];
        }
        field++;
    }
    return problem;
}

#endif