#include <stdio.h>
#include <stdlib.h>
#include <mysql.h>
#include "db_config.h"

int main(void) {
    MYSQL *conn;
    MYSQL_RES *result;
    MYSQL_ROW row;
    conn = open_project_database();
    if (conn == NULL) {
        fprintf(stderr, "Database connection failed or not configured\n");
        return 1;
    }
    
    if (mysql_query(conn,
            "SELECT "
            " COUNT(DISTINCT s.id), "
            " COUNT(DISTINCT CASE WHEN cls.id IS NOT NULL THEN s.id END), "
            " COUNT(DISTINCT CASE WHEN cls.id IS NOT NULL "
            "     AND LOWER(TRIM(COALESCE(s.status, 'active'))) = 'active' THEN s.id END), "
            " COUNT(DISTINCT CASE WHEN cls.id IS NOT NULL "
            "     AND LOWER(TRIM(s.status)) = 'shifted' THEN s.id END), "
            " COUNT(DISTINCT CASE WHEN cls.id IS NOT NULL "
            "     AND LOWER(TRIM(s.status)) = 'dropped' THEN s.id END) "
            "FROM students s "
            "LEFT JOIN class_list_students link ON link.student_id = s.id "
            "LEFT JOIN class_list_schedules cls ON cls.id = link.class_list_schedule_id "
            "WHERE LOWER(REPLACE(REPLACE(TRIM(COALESCE(s.course, '')), ' ', ''), '-', '')) "
            "LIKE 'bsit%'") != 0) {
        fprintf(stderr, "Dashboard query failed: %s\n", mysql_error(conn));
        mysql_close(conn);
        return 1;
    }
    result = mysql_store_result(conn);
    if (result == NULL) {
        fprintf(stderr, "Dashboard query returned nothing\n");
        mysql_close(conn);
        return 1;
    }
    row = mysql_fetch_row(result);
    if (row == NULL) {
        fprintf(stderr, "Dashboard query returned no row\n");
        mysql_free_result(result);
        mysql_close(conn);
        return 1;
    }
    printf("{\"source\":\"c\"");
    printf(",\"allStudents\":%s", row[0]);
    printf(",\"totalStudents\":%s", row[1]);
    printf(",\"activeStudents\":%s", row[2]);
    printf(",\"shiftedStudents\":%s", row[3]);
    printf(",\"droppedStudents\":%s", row[4]);
    printf("}\n");
    mysql_free_result(result);
    mysql_close(conn);
    return 0;
}
