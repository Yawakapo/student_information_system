#ifndef SIS_SCHEDULE_TEXT_H
#define SIS_SCHEDULE_TEXT_H
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <mysql.h>
#include "db_config.h"
typedef struct {
    long id;
    char teacher_id[256];
    char professor_name[256];
    char subject[151];
    char course[51];
    char day[21];
    char start[16];
    char end[16];
    char room[101];
} Schedule;

#define BSIT_COURSE "BSIT"
#define BSIT_DEPARTMENT "School of Information Technology"
static int to_minutes(char *text, int *result)

{
    int hour;
    int minute;
    int found;
    if (text == NULL) return 0;
    found = sscanf(text, "%d:%d", &hour, &minute);
    if (found < 2) return 0;
    if (hour < 0) return 0;
    if (hour > 23) return 0;
    if (minute < 0) return 0;
    if (minute > 59) return 0;
    *result = hour * 60 + minute;
    return 1;
}
static int same_text(char *a, char *b) {
    int i = 0;
    int j = 0;
    if (a == NULL) return 0;
    if (b == NULL) return 0;
    for (;;) {
        while (a[i] == ' ') i++;
        while (b[j] == ' ') j++;
        if (a[i] == '\0') break;
        if (b[j] == '\0') break;
        int x = a[i];
        int y = b[j];
        if (x >= 'A') {
            if (x <= 'Z') x = x + 32;
        }
        if (y >= 'A') {
            if (y <= 'Z') y = y + 32;
        }
        if (x != y) return 0;
        i++;
        j++;
    }
    while (a[i] == ' ') i++;
    while (b[j] == ' ') j++;
    if (a[i] != '\0') return 0;
    if (b[j] != '\0') return 0;
    return 1;
}
static void name_key(char *text, char *out) {
    int used = 0;
    int i;
    out[0] = '\0';
    if (text == NULL) return;
    for (i = 0; text[i] != '\0'; i++) {
        int c = text[i];
        if (c >= 'A') {
            if (c <= 'Z') c = c + 32;
        }
        int is_letter = 0;
        int is_digit = 0;
        if (c >= 'a') {
            if (c <= 'z') is_letter = 1;
        }
        if (c >= '0') {
            if (c <= '9') is_digit = 1;
        }
        if (is_letter == 1) {
            out[used] = c;
            used++;
            out[used] = '\0';
        }
        if (is_digit == 1) {
            out[used] = c;
            used++;
            out[used] = '\0';
        }
    }
}
static int is_bsit(char *course) {
    char joined[51];
    name_key(course, joined);
    return strncmp(joined, "bsit", 4) == 0;
}
static void number_list(char *out, long *values, int count) {
    int i;
    out[0] = '\0';
    for (i = 0; i < count; i++) {
        if (i > 0) strcat(out, ",");
        char piece[16];
        sprintf(piece, "%ld", values[i]);
        strcat(out, piece);
    }
}
static void to_class_time(char *start, char *end, char *out) {
    int sh = 0;
    int sm = 0;
    int eh = 0;
    int em = 0;
    int s12;
    int e12;
    char *start_ampm;
    char *end_ampm;
    if (start != NULL) sscanf(start, "%d:%d", &sh, &sm);
    if (end != NULL) sscanf(end, "%d:%d", &eh, &em);
    s12 = sh % 12;
    if (s12 == 0) s12 = 12;
    e12 = eh % 12;
    if (e12 == 0) e12 = 12;
    start_ampm = "AM";
    end_ampm = "AM";
    if (sh >= 12) start_ampm = "PM";
    if (eh >= 12) end_ampm = "PM";
    sprintf(out, "%d:%02d %s - %d:%02d %s", s12, sm, start_ampm, e12, em, end_ampm);
}
#endif
