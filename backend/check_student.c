#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <mysql.h>
#include "db_config.h"
#include "student_text.h"

/* Prints the refusal and stops. Every rule that says no comes through here, so
   the shape of an answer is always the same. */
static void refuse(char *message) {
    printf("{\"status\":\"error\",\"message\":");
    json_print_string(message);
    printf("}\n");
}


static char *argument_value(int argc, char *argv[], int at) {
    if (at >= argc) return NULL;
    return strchr(argv[at], '=') + 1;
}

/* Counts the students already holding this student number. Anything above zero
   means the number is taken. */
static int number_already_used(MYSQL *conn, char *student_no) {
    MYSQL_RES *result;
    MYSQL_ROW row;
    char *statement;
    int found = 0;
    statement = (char *)malloc(120 + strlen(student_no));
    if (statement == NULL) return 0;
    sprintf(statement,
            "SELECT COUNT(*) FROM students WHERE TRIM(student_no) = '%s'",
            student_no);
    if (mysql_query(conn, statement) == 0) {
        result = mysql_store_result(conn);
        if (result != NULL) {
            row = mysql_fetch_row(result);
            if (row != NULL) found = atoi(row[0]);
            mysql_free_result(result);
        }
    }
    free(statement);
    return found;
}

int main(int argc, char *argv[]) {
    MYSQL *conn;
    Student s;
    char *problem;

    
    if (argc < 11) {
        refuse("Missing required student registration details.");
        return 1;
    }

    memset(&s, 0, sizeof(s));

   
    problem = student_too_long(&s, argv, 1, 9);

    if (problem == NULL) {
        problem = student_empty_field(&s);
    }
    if (problem != NULL) {
        printf("{\"status\":\"error\",\"code\":\"rejected\",\"message\":");
        json_print_string(problem);
        printf("}\n");
        return 1;
    }

    
    copy_text_bounded(s.course, argument_value(argc, argv, 10), 51);
    problem = student_course_problem(&s);
    if (problem != NULL) {
        printf("{\"status\":\"error\",\"code\":\"not_bsit\",\"message\":");
        json_print_string(problem);
        printf("}\n");
        return 1;
    }

    
    conn = open_project_database();
    if (conn != NULL) {
        if (number_already_used(conn, s.student_no) > 0) {
            printf("{\"status\":\"error\",\"code\":\"duplicate\",\"message\":");
            json_print_string(student_number_taken_message);
            printf("}\n");
            mysql_close(conn);
            return 1;
        }
        mysql_close(conn);
    }

    /* Every rule passed. */
    printf("{\"status\":\"success\",\"source\":\"c\",\"student_no\":");
    json_print_string(s.student_no);
    printf("}\n");
    return 0;
}