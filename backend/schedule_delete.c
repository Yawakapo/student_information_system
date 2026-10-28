#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <mysql.h>
#include "db_config.h"
#include "schedule_text.h"
#include "schedule_db.h"
void action_delete(MYSQL *conn, long id) {
    char statement[8492];
    char list_text[8192];
    long list_ids[512];
    long student_ids[2048];
    int list_count = 0;
    int student_count = 0;
    int i;
    sprintf(statement, "SELECT id FROM class_list_schedules WHERE source_schedule_id = %ld", id);
    if (mysql_query(conn, statement) == 0) {
        MYSQL_RES *result = mysql_store_result(conn);
        MYSQL_ROW row;
        while (result != NULL) {
            if (list_count >= 512) break;
            row = mysql_fetch_row(result);
            if (row == NULL) break;
            list_ids[list_count] = atol(row[0]);
            list_count++;
        }
        if (result != NULL) mysql_free_result(result);
    }
    if (list_count > 0) {
        number_list(list_text, list_ids, list_count);
        strcpy(statement, "SELECT DISTINCT student_id FROM class_list_students WHERE class_list_schedule_id IN (");
        strcat(statement, list_text);
        strcat(statement, ")");
        if (mysql_query(conn, statement) == 0) {
            MYSQL_RES *result = mysql_store_result(conn);
            MYSQL_ROW row;
            while (result != NULL) {
                if (student_count >= 2048) break;
                row = mysql_fetch_row(result);
                if (row == NULL) break;
                student_ids[student_count] = atol(row[0]);
                student_count++;
            }
            if (result != NULL) mysql_free_result(result);
        }
    }
    mysql_query(conn, "START TRANSACTION");
    if (list_count > 0) {
        strcpy(statement, "DELETE FROM class_list_students WHERE class_list_schedule_id IN (");
        strcat(statement, list_text);
        strcat(statement, ")");
        mysql_query(conn, statement);
        strcpy(statement, "DELETE FROM class_list_schedules WHERE id IN (");
        strcat(statement, list_text);
        strcat(statement, ")");
        mysql_query(conn, statement);
    }
    sprintf(statement, "DELETE FROM schedule_student_assignments WHERE schedule_id = %ld", id);
    mysql_query(conn, statement);
    sprintf(statement, "DELETE FROM class_schedules WHERE id = %ld", id);
    if (mysql_query(conn, statement) != 0) {
        mysql_query(conn, "ROLLBACK");
        reply_error("database", "Could not remove the schedule.");
        return;
    }
    mysql_query(conn, "COMMIT");
    printf("{\"status\":\"success\",\"id\":%ld,\"student_ids\":[", id);
    for (i = 0; i < student_count; i++) {
        if (i > 0) fputc(',', stdout);
        printf("%ld", student_ids[i]);
    }
    printf("],\"source\":\"c-native-worker\"}\n");
}
