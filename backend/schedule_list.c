#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <mysql.h>
#include "db_config.h"
#include "schedule_text.h"
#include "schedule_db.h"
void action_list(MYSQL *conn) {
    if (mysql_query(conn,
        "SELECT id, COALESCE(NULLIF(TRIM(teacher_id),''),''), "
        " COALESCE(NULLIF(TRIM(professor_name),''),''), COALESCE(NULLIF(TRIM(subject),''),''), "
        " COALESCE(NULLIF(TRIM(course),''),''), COALESCE(NULLIF(TRIM(day),''),''), "
        " TIME_FORMAT(start_time,'%H:%i:%s'), TIME_FORMAT(end_time,'%H:%i:%s'), "
        " COALESCE(NULLIF(TRIM(room_lab),''),'') "     
        "FROM class_schedules ORDER BY id DESC") != 0) {
        reply_error("database", "Could not read the timetable.");
        return;
    }
    MYSQL_RES *result = mysql_store_result(conn);
    MYSQL_ROW row;
    int first_row = 1;
    printf("{\"status\":\"success\",\"schedules\":[");
    while (result != NULL) {
        row = mysql_fetch_row(result);
        if (row == NULL) break;
        json_row_separator(&first_row);
        printf("{\"id\":%s", row[0]);
        json_field("teacher_id", row[1]);
        json_field("professor_name", row[2]);
        json_field("subject", row[3]);
        json_field("course", row[4]);
        json_field("day", row[5]);
        json_field("start_time", row[6]);
        json_field("end_time", row[7]);
        json_field("room_lab", row[8]);
        fputc('}', stdout);
    }
    if (result != NULL) mysql_free_result(result);
    printf("]}\n");
}
