#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <mysql.h>
#include "db_config.h"

static int run_list(MYSQL *conn) {
    MYSQL_RES *result;
    MYSQL_ROW row;
    int first_row = 1;
    if (mysql_query(conn,
            "SELECT t.id, t.teacher_id, t.user_account_id, t.first_name, t.middle_name, "
            "       t.last_name, t.email, t.department, t.status, "
            "       u.user_id, u.email, u.status, "
            "       COUNT(DISTINCT cs.id), COUNT(DISTINCT cls.id) "
            "FROM teachers t "
            "LEFT JOIN users u ON u.id = t.user_account_id "
            "LEFT JOIN class_schedules cs ON LOWER(TRIM(cs.teacher_id)) = LOWER(TRIM(t.teacher_id)) "
            "LEFT JOIN class_list_schedules cls ON LOWER(TRIM(cls.teacher_id)) = LOWER(TRIM(t.teacher_id)) "
            "GROUP BY t.id, t.teacher_id, t.user_account_id, t.first_name, t.middle_name, "
            "         t.last_name, t.email, t.department, t.status, u.user_id, u.email, u.status "
            "ORDER BY t.last_name, t.first_name, t.teacher_id") 
            
            != 0) {
        fprintf(stderr, "Professor list failed: %s\n", mysql_error(conn));
        return 0;
    }

    result = mysql_store_result(conn);
    if (result == NULL) {
        fprintf(stderr, "Professor list returned nothing\n");
        return 0;
    }
    printf("{\"source\":\"c\",\"teachers\":[");
    while ((row = mysql_fetch_row(result)) != NULL)
    
    {
        char full_name[512];
        
        copy_text_bounded(full_name, "", 512);
        if (row[3] != NULL) {
            strcat(full_name, row[3]);
        }
        if (row[4] != NULL) {
            if (full_name[0] != '\0') strcat(full_name, " ");
            strcat(full_name, row[4]);
        }
        if (row[5] != NULL) {
            if (full_name[0] != '\0') strcat(full_name, " ");
            strcat(full_name, row[5]);
        }

            json_row_separator(&first_row);
            printf("{\"id\":%s", row[0]);
            json_field("teacher_id", row[1]);
            json_number_or_null("user_account_id", row[2]);
            json_field("first_name", row[3]);
            json_field("middle_name", row[4]);
            json_field("last_name", row[5]);
            json_field("full_name", full_name);
            json_field("email", row[6]);
            json_field("department", row[7]);
            json_field("status", row[8]);
            json_field("account_username", row[9]);
            json_field("account_email", row[10]);
            json_field("account_status", row[11]);
            json_number_or_null("schedule_count", row[12]);
            json_number_or_null("class_list_count", row[13]);
            fputc('}', stdout);
    }
    json_end_list();
    printf("}\n");
    mysql_free_result(result);
    return 1;
}
int main(int argc, char *argv[]) {
    MYSQL *conn;
    if (argc < 2) {
        fprintf(stderr, "How to run: teachers_worker <list|create> [key=value ...]\n");
        return 1;
    }
    conn = open_project_database();
    if (conn == NULL) {
        fprintf(stderr, "Database connection failed or not configured\n");
        return 1;
    }
    if (strcmp(argv[1], "list") == 0) {
        run_list(conn);
        } else {
        fprintf(stderr, "Unknown action: %s\n", argv[1]);
        mysql_close(conn);
        return 1;
    }
    mysql_close(conn);
    return 0;
}
