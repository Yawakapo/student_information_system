#include <stdio.h>
#include <stdlib.h>
#include <mysql.h>
#include "db_config.h"
int main(void) {
    MYSQL *conn;
    MYSQL_RES *result;
    MYSQL_ROW row;
    int first_row = 1;
    conn = open_project_database();
    if (conn == NULL) {
        fprintf(stderr, "Database connection failed or not configured\n");
        return 1;
    }
    if (mysql_query(conn,
            "SELECT s.id, s.student_no, s.first_name, s.last_name, s.year_level, "
            "       s.course, s.department, s.status, s.day, s.class_time, s.teacher_id, "
            "       u.id, u.user_id, u.status, "
            "       (SELECT COUNT(*) FROM class_list_students link "
            "         WHERE link.student_id = s.id) "
            "FROM students s "
            "LEFT JOIN users u ON u.id = s.user_account_id "
            "WHERE s.teacher_id IS NULL "
            "   OR TRIM(s.teacher_id) = '' "
            "   OR NOT EXISTS ("
            "        SELECT 1 FROM teachers t "
            "        WHERE LOWER(TRIM(t.teacher_id)) = LOWER(TRIM(s.teacher_id))"
            "      ) "
            "ORDER BY s.last_name, s.first_name, s.student_no") != 0) {
        fprintf(stderr, "Unassigned student query failed: %s\n", mysql_error(conn));
        mysql_close(conn);
        return 1;
    }
    result = mysql_store_result(conn);
    if (result == NULL) {
        fprintf(stderr, "Unassigned student query returned nothing\n");
        mysql_close(conn);
        return 1;
    }
    printf("{\"source\":\"c\",\"students\":[");
    while ((row = mysql_fetch_row(result)) != NULL) {
        json_row_separator(&first_row);
        printf("{\"id\":%s", row[0]);
        json_field("student_no", row[1]);
        json_field("first_name", row[2]);
        json_field("last_name", row[3]);
        json_field("year_level", row[4]);
        json_field("course", row[5]);
        json_field("department", row[6]);
        json_field("status", row[7]);
        json_field("day", row[8]);
        json_field("class_time", row[9]);
        json_field("teacher_id", row[10]);
        json_number_or_null("user_account_id", row[11]);
        json_field("account_username", row[12]);
        json_field("account_status", row[13]);
        json_number("class_list_count", atol(row[14]));
        fputc('}', stdout);
    }
    json_end_list();
    printf("}\n");
    mysql_free_result(result);
    mysql_close(conn);
    return 0;
}
