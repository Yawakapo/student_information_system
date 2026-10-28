#ifndef SIS_SCHEDULE_DB_H
#define SIS_SCHEDULE_DB_H
#include "schedule_text.h"

static void reply_error(char *code, char *message) {
    printf("{\"status\":\"error\",\"code\":\"%s\",\"message\":\"", code);
    json_escape(message);
    printf("\"}\n");
}
static void reply_ok(long id) {
    printf("{\"status\":\"success\",\"id\":%ld,\"source\":\"c-native-worker\"}\n", id);
}
static void resolve_teacher(MYSQL *conn, Schedule *s) {
    char wanted[256];
    char full[512];
    char part[256];
    if (s->teacher_id[0] != '\0') return;
    if (s->professor_name[0] == '\0') return;
    name_key(s->professor_name, wanted);
    if (wanted[0] == '\0') return;
    if (mysql_query(conn, "SELECT teacher_id, first_name, middle_name, last_name FROM teachers") != 0) return;
    MYSQL_RES *result = mysql_store_result(conn);
    if (result == NULL) return;
    MYSQL_ROW row;

    while ((row = mysql_fetch_row(result)) != NULL) {
        full[0] = '\0';
        name_key(row[1], part); strcat(full, part);
        name_key(row[2], part); strcat(full, part);
        name_key(row[3], part); strcat(full, part);
        if (strcmp(full, wanted) == 0) {
            copy_text_bounded(s->teacher_id, row[0], 256);
            break;
        }
        if (full[0] != '\0') {
            if (strstr(full, wanted) != NULL) {
                copy_text_bounded(s->teacher_id, row[0], 256);
                break;
            }
        }
        if (wanted[0] != '\0') {
            if (strstr(wanted, full) != NULL) {
                copy_text_bounded(s->teacher_id, row[0], 256);
                break;
            }
        }
    }
    mysql_free_result(result);
}
static int clashes(MYSQL *conn, Schedule *s, long skip_id, char *message) {
    int from = 0;
    int to = 0;
    int busy_from;
    int busy_to;
    int found = 0;
    if (to_minutes(s->start, &from) == 0) return 0;
    if (to_minutes(s->end, &to) == 0) return 0;
    if (from >= to) return 0;
    char safe_teacher[512];
    copy_text_bounded(safe_teacher, s->teacher_id, 512);
    char query[1682];
    char skip_text[16];
    sprintf(skip_text, "%ld", skip_id);
    sprintf(query,
            "SELECT id, COALESCE(NULLIF(TRIM(subject),''),'(untitled)'),"
            " COALESCE(NULLIF(TRIM(day),''),''),"
            " TIME_FORMAT(start_time,'%%H:%%i:%%s'),"
            " TIME_FORMAT(end_time,'%%H:%%i:%%s')"
            " FROM class_schedules WHERE id <> %s"
            " AND LOWER(TRIM(teacher_id)) = LOWER('%s')",
            skip_text, safe_teacher);
    if (mysql_query(conn, query) != 0) return 0;
    MYSQL_RES *result = mysql_store_result(conn);
    if (result == NULL) return 0;
    MYSQL_ROW row;
    while ((row = mysql_fetch_row(result)) != NULL) {
        if (same_text(row[2], s->day) == 0) continue;
        if (to_minutes(row[3], &busy_from) == 0) continue;
        if (to_minutes(row[4], &busy_to) == 0) continue;
        if (from >= busy_to) continue;
        if (to <= busy_from) continue;
        sprintf(message, "%s already has %s on %s at %s to %s",
                s->professor_name, row[1], row[2], row[3], row[4]);
        found = 1;
        break;
    }
    mysql_free_result(result);
    return found;
}
static char *check_rules(Schedule *s) {
    int from = 0;
    int to = 0;
    if (s->subject[0] == '\0') return "missing_subject";
    if (s->professor_name[0] == '\0') {
        if (s->teacher_id[0] == '\0') return "missing_professor";
    }
    if (s->day[0] == '\0') return "missing_day";
    if (s->start[0] == '\0') return "missing_time";
    if (s->end[0] == '\0') return "missing_time";
    if (to_minutes(s->start, &from) == 0) return "bad_time";
    if (to_minutes(s->end, &to) == 0) return "bad_time";
    if (from >= to) return "end_before_start";
    return NULL;
}
static int load_stored(MYSQL *conn, Schedule *s)
 {
    char query[1682];
    sprintf(query,
        "SELECT teacher_id, professor_name, subject, course, day, "
        " TIME_FORMAT(start_time,'%%H:%%i:%%s'), TIME_FORMAT(end_time,'%%H:%%i:%%s'), "
        " COALESCE(NULLIF(TRIM(room_lab),''),'') "     
        "FROM class_schedules WHERE id = %ld LIMIT 1", s->id);
    if (mysql_query(conn, query) != 0) return 0;
    MYSQL_RES *result = mysql_store_result(conn);
    if (result == NULL) return 0;
    MYSQL_ROW row = mysql_fetch_row(result);
    if (row == NULL) {
        mysql_free_result(result);
        return 0;
    }
    copy_text_bounded(s->teacher_id, row[0], 256);
    copy_text_bounded(s->professor_name, row[1], 256);
    copy_text_bounded(s->subject, row[2], 151);
    copy_text_bounded(s->course, row[3], 51);
    copy_text_bounded(s->day, row[4], 21);
    copy_text_bounded(s->start, row[5], 16);
    copy_text_bounded(s->end, row[6], 16);
    copy_text_bounded(s->room, row[7], 101);
    mysql_free_result(result);
    return 1;
}
void action_list(MYSQL *conn);
void action_save(MYSQL *conn, int creating, Schedule *given);
void action_delete(MYSQL *conn, long id);
#endif
