#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <mysql.h>
#include "db_config.h"
#include "schedule_text.h"
#include "schedule_db.h"

static void build_insert(char *out, Schedule *s) {
    sprintf(out,
        "INSERT INTO class_schedules (teacher_id, subject, section_course, department,"
        " course, professor_name, room_lab, day, start_time, end_time, created_at)"
        " VALUES ('%s','%s','%s','%s','%s','%s','%s','%s','%s','%s', NOW())",
        s->teacher_id, s->subject, BSIT_COURSE, BSIT_DEPARTMENT, BSIT_COURSE,
        s->professor_name, s->room, s->day, s->start, s->end);
}
static void build_update(char *out, Schedule *s) {
    sprintf(out,
        "UPDATE class_schedules SET teacher_id='%s', subject='%s', section_course='%s',"
        " department='%s', course='%s', professor_name='%s', room_lab='%s', day='%s',"
        " start_time='%s', end_time='%s' WHERE id = %ld",
        s->teacher_id, s->subject, BSIT_COURSE, BSIT_DEPARTMENT, BSIT_COURSE,
        s->professor_name, s->room, s->day, s->start, s->end, s->id);
}
static void build_list_insert(char *out, Schedule *s, long id, char *class_time) {
    sprintf(out,
        "INSERT INTO class_list_schedules (source_schedule_id, subject, section_course,"
        " department, course, day, class_time, teacher_id, professor_name)"
        " VALUES (%ld,'%s','%s','%s','%s','%s','%s','%s','%s')",
        id, s->subject, BSIT_COURSE, BSIT_DEPARTMENT, BSIT_COURSE,
        s->day, class_time, s->teacher_id, s->professor_name);
}
void action_save(MYSQL *conn, int creating, Schedule *given) {
    Schedule s;
    char statement[1682];
    char clash_text[1078];
    char *problem;
    long saved_id;
    memset(&s, 0, sizeof(s));
    s.id = given->id;
    if (creating == 0) {
        if (load_stored(conn, &s) == 0) {
            reply_error("not_found", "Schedule entry not found.");
            return;
        }
    }
    if (given->teacher_id[0] != '\0')     copy_text_bounded(s.teacher_id, given->teacher_id, 256);
    if (given->professor_name[0] != '\0') copy_text_bounded(s.professor_name, given->professor_name, 256);
    if (given->subject[0] != '\0')        copy_text_bounded(s.subject, given->subject, 151);
    if (given->day[0] != '\0')            copy_text_bounded(s.day, given->day, 21);
    if (given->start[0] != '\0')          copy_text_bounded(s.start, given->start, 16);
    if (given->end[0] != '\0')            copy_text_bounded(s.end, given->end, 16);
    if (given->room[0] != '\0')           copy_text_bounded(s.room, given->room, 101);
    copy_text_bounded(s.course, BSIT_COURSE, 51);
    resolve_teacher(conn, &s);
    problem = check_rules(&s);
    if (problem != NULL) {
        reply_error(problem, "The schedule details are not valid.");
        return;
    }
    saved_id = 0;
    if (creating == 0) saved_id = s.id;
    if (clashes(conn, &s, saved_id, clash_text) == 1) {
        reply_error("conflict", clash_text);
        return;
    }
    if (creating == 1) {
        build_insert(statement, &s);
    } else {
        build_update(statement, &s);
    }
    mysql_query(conn, "START TRANSACTION");
    if (mysql_query(conn, statement) != 0) {
        char reason[256];
        strcpy(reason, mysql_error(conn));
        mysql_query(conn, "ROLLBACK");
        reply_error("database", reason);
        return;
    }
    if (creating == 1) {
        saved_id = mysql_insert_id(conn);
        char class_time[61];
        to_class_time(s.start, s.end, class_time);
        build_list_insert(statement, &s, saved_id, class_time);
    } else {
        sprintf(statement,
            "UPDATE class_list_schedules SET subject='%s', department='%s', course='%s',"
            " day='%s', teacher_id='%s', professor_name='%s' WHERE source_schedule_id = %ld",
            s.subject, BSIT_DEPARTMENT, BSIT_COURSE, s.day, s.teacher_id, s.professor_name, s.id);
    }
    mysql_query(conn, statement);
    mysql_query(conn, "COMMIT");
    reply_ok(saved_id);
}
