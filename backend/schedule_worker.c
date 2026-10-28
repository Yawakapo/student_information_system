#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <mysql.h>
#include "db_config.h"
#include "schedule_text.h"
#include "schedule_db.h"

static struct {
    char *name;
    int size;
    char *message;
} fields[] = {
    { "teacher_id",     256 ,    "The teacher id is longer than the column allows." },
    { "professor_name", 256 ,    "The professor name is longer than the column allows." },
    { "subject",        151 , "The subject is longer than the column allows." },
    { "course",         51 ,   "The course is longer than the column allows." },
    { "day",            21 ,     "The day is longer than the column allows." },
    { "start",          16 ,    "The start time is longer than the column allows." },
    { "end",            16 ,    "The end time is longer than the column allows." },
    { "room",           101 ,    "The room is longer than the column allows." }
};
static int field_count = 8;
static char *slots[8];

int main(int argc, char *argv[]) {
    char *action;
    Schedule given;
    MYSQL *conn;

    int i;
    if (argc < 2) {
        fprintf(stderr, "How to run: schedule_worker <create|update|delete|list> [key=value ...]\n");
        return 1;
    }
    action = argv[1];
    
    memset(&given, 0, sizeof(given));
    slots[0] = given.teacher_id;
    slots[1] = given.professor_name;
    slots[2] = given.subject;
    slots[3] = given.course;
    slots[4] = given.day;
    slots[5] = given.start;
    slots[6] = given.end;
    slots[7] = given.room;

    for (i = 2; i < argc; i++) {
        char *pair = argv[i];
        char *equals;
        char *key;
        char *value;
        int f;
        int matched = 0;
        equals = strchr(pair, '=');
        if (equals == NULL) continue;
        *equals = '\0';
        key = pair;
        value = equals + 1;
        for (f = 0; f < field_count; f++) {
            if (strcmp(key, fields[f].name) != 0) continue;
            if (strlen(value) > fields[f].size - 1) {
                reply_error("too_long", fields[f].message);
                return 0;
            }
            copy_text_bounded(slots[f], value, fields[f].size);
            matched = 1;
        }
        if (strcmp(key, "id") == 0) {
            given.id = atol(value);
            matched = 1;
        }
        if (matched == 0) continue;
    }
    conn = open_project_database();
    if (conn == NULL) {
        fprintf(stderr, "Database connection failed or not configured\n");
        return 1;
    }
    if (given.course[0] != '\0') {
        if (is_bsit(given.course) == 0) {
            reply_error("not_bsit", "Only BSIT schedules are allowed in this system.");
            mysql_close(conn);
            return 0;
        }
    }
    if (strcmp(action, "list") == 0) {
        action_list(conn);
    } else if (strcmp(action, "delete") == 0) {
        action_delete(conn, given.id);
    } else if (strcmp(action, "create") == 0) {
        action_save(conn, 1, &given);
    } else if (strcmp(action, "update") == 0) {
        action_save(conn, 0, &given);
    } else {
        fprintf(stderr, "Unknown action: %s\n", action);
        mysql_close(conn);
        return 1;
    }
    mysql_close(conn);
    return 0;
}
