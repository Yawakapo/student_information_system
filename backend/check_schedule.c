#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <mysql.h>
#include "db_config.h"
#include "schedule_text.h"
static int same_day(char *stored, char *wanted) {
    char a[51];
    char b[51];
    int i;
    if (stored == NULL) return 0;
    if (wanted == NULL) return 0;
    name_key(stored, a);
    name_key(wanted, b);
    if (strlen(a) < 3) {
        if (strlen(b) < 3) {
            if (strcmp(a, b) == 0) return 1;
            return 0;
        }
        return 0;
    }
    if (strlen(b) < 3) return 0;
    for (i = 0; i < 3; i++) {
        if (a[i] != b[i]) return 0;
    }
    return 1;
}
static int all_fit(char *a, int la, char *b, int lb, char *c, int lc, char *d, int ld) {
    if (a == NULL) return 0;
    if (strlen(a) > la - 1) return 0;
    if (b == NULL) return 0;
    if (strlen(b) > lb - 1) return 0;
    if (c == NULL) return 0;
    if (strlen(c) > lc - 1) return 0;
    if (d == NULL) return 0;
    if (strlen(d) > ld - 1) return 0;
    return 1;
}
static int too_long_reply(void) {
    printf("{\"status\":\"error\",\"message\":\"Input is too long\"}\n");
    return 1;
}
static void reply_bad_time(char *message) {
    printf("{\"status\":\"success\",\"valid\":false,\"conflict\":false,\"conflicts\":[],");
    printf("\"message\":\"%s\"}\n", message);
}
int main(int argc, char *argv[]) {
    MYSQL *conn;
    MYSQL_RES *result;
    MYSQL_ROW row;
    int from = 0;
    int to = 0;
    int busy_from;
    int busy_to;
    int skip_id = 0;
    int clashes = 0;
    int first_row = 1;
    int i;
    if (argc < 5) {
        fprintf(stderr, "How to run: check_schedule <teacher_id> <day> <start> <end> [id_to_skip]\n");
        return 1;
    }
    char *teacher_id = argv[1];
    char *day = argv[2];
    char *start_text = argv[3];
    char *end_text = argv[4];
    if (argc > 5) skip_id = atoi(argv[5]);
    if (all_fit(teacher_id, 256, day, 21, start_text, 16, end_text, 16) == 0) return too_long_reply();
    int readable = 1;
    if (to_minutes(start_text, &from) == 0) readable = 0;
    if (to_minutes(end_text, &to) == 0) readable = 0;
    if (readable == 0) {
        reply_bad_time("Enter valid start and end times.");
        return 0;
    }
    if (from >= to) {
        reply_bad_time("End time must be later than start time.");
        return 0;
    }
    conn = open_project_database();
    if (conn == NULL) {
        fprintf(stderr, "Database connection failed or not configured\n");
        return 1;
    }
    char query[1682];
    char safe_teacher[512];
    copy_text_bounded(safe_teacher, teacher_id, 512);
    strcpy(query, "SELECT id, "
                  " COALESCE(NULLIF(TRIM(subject), ''), '(untitled)'), "
                  " COALESCE(NULLIF(TRIM(day), ''), ''), "
                  " TIME_FORMAT(start_time, '%H:%i:%s'), TIME_FORMAT(end_time, '%H:%i:%s'), "
                  " COALESCE(NULLIF(TRIM(room_lab), ''), '') "      
                  "FROM class_schedules "
                  "WHERE LOWER(TRIM(teacher_id)) = LOWER('");
    strcat(query, safe_teacher);
    strcat(query, "') OR LOWER(TRIM(professor_name)) = LOWER('");
    strcat(query, safe_teacher);
    strcat(query, "')");
    if (mysql_query(conn, query) != 0) {
        fprintf(stderr, "Clash query failed: %s\n", mysql_error(conn));
        mysql_close(conn);
        return 1;
    }
    result = mysql_store_result(conn);
    if (result == NULL) {
        fprintf(stderr, "Clash query returned nothing\n");
        mysql_close(conn);
        return 1;
    }
    printf("{\"status\":\"success\",\"conflicts\":[");
    while ((row = mysql_fetch_row(result)) != NULL) {
        i = atoi(row[0]);
        if (skip_id > 0) {
            if (i == skip_id) continue;
        }
        if (same_day(row[2], day) == 0) continue;
        if (to_minutes(row[3], &busy_from) == 0) continue;
        if (to_minutes(row[4], &busy_to) == 0) continue;
        if (from >= busy_to) continue;
        if (to <= busy_from) continue;
        json_row_separator(&first_row);
        printf("{\"id\":%s", row[0]);
        json_field("subject", row[1]);
        json_field("day", row[2]);
        json_field("start_time", row[3]);
        json_field("end_time", row[4]);
        json_field("room_lab", row[5]);
        fputc('}', stdout);
        clashes++;
    }
    json_end_list();
    if (clashes == 0) {
        printf(",\"valid\":true,\"conflict\":false,");
        printf("\"message\":\"No clash found.\"}\n");
    } else {
        printf(",\"valid\":false,\"conflict\":true,");
        printf("\"message\":\"That professor already has a class at this time.\"}\n");
    }
    mysql_free_result(result);
    mysql_close(conn);
    return 0;
}
