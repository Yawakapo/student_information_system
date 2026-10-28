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
            "SELECT cs.id, cs.teacher_id, cs.subject, cs.section_course, "
            "       cs.department, cs.course, cs.room_lab, cs.day, "
            "       TIME_FORMAT(cs.start_time, '%H:%i:%s'), "
            "       TIME_FORMAT(cs.end_time, '%H:%i:%s'), "
            "       DATE_FORMAT(cs.created_at, '%Y-%m-%d %H:%i:%s'), "
            "       COALESCE(NULLIF(TRIM(cs.professor_name), ''), "
            "                NULLIF(TRIM(CONCAT(COALESCE(t.first_name, ''), ' ', "
            "                      COALESCE(t.middle_name, ''), ' ', "
            "                      COALESCE(t.last_name, ''))), ''), "
            "                NULLIF(TRIM(cs.teacher_id), ''), "
            "                CONCAT('Schedule: ', cs.subject)) "
            "FROM class_schedules cs "
            "LEFT JOIN teachers t ON t.teacher_id = cs.teacher_id "
            "ORDER BY cs.id DESC") != 0) {
        fprintf(stderr, "Schedule query failed: %s\n", mysql_error(conn));
        mysql_close(conn);
        return 1;
    }
    result = mysql_store_result(conn);
    if (result == NULL) {
        fprintf(stderr, "Schedule query returned nothing\n");
        mysql_close(conn);
        return 1;
    }
    printf("{\"source\":\"c\",\"schedules\":[");
    while ((row = mysql_fetch_row(result)) != NULL) {
        json_row_separator(&first_row);
        printf("{\"id\":%s", row[0]);
        json_field("teacher_id", row[1]);
        json_field("subject", row[2]);
        json_field("section_course", row[3]);
        json_field("department", row[4]);
        json_field("course", row[5]);
        json_field("room_lab", row[6]);
        json_field("day", row[7]);
        json_field("start_time", row[8]);
        json_field("end_time", row[9]);
        json_field("created_at", row[10]);
        json_field("professor_name", row[11]);
        fputc('}', stdout);
    }
    json_end_list();
    printf("}\n");
    mysql_free_result(result);
    mysql_close(conn);
    return 0;
}
