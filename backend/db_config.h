#ifndef SIS_DB_CONFIG_H
#define SIS_DB_CONFIG_H
#include <mysql.h>
#include <stdlib.h>
#include <stdio.h>

static MYSQL *open_project_database(void) {
    char *host = getenv("DB_HOST");
    char *user = getenv("DB_USER");
    char *password = getenv("DB_PASSWORD");
    char *database = getenv("DB_NAME");
    if (host == NULL) host = "127.0.0.1";
    if (user == NULL) user = getenv("SQL_USER");
    if (password == NULL) password = getenv("SQL_PASS");
    if (database == NULL) database = "student_information_system";
    if (user == NULL) return NULL;

    //opens a connection to db
    MYSQL *connection = mysql_init(NULL);
    if (connection == NULL) return NULL;

    if (mysql_real_connect(connection, host, user, password, database, 3306, NULL, 0) == 0) {
        mysql_close(connection);
        return NULL;
    }
    return connection;

}
    
static void json_escape(char *text) {
    if (text == NULL) return;
    int i = 0;
    while (text[i] != '\0') {
        if (text[i] == '"') {
            fputs("\\\"", stdout);
        } else if (text[i] == '\\') {
            fputs("\\\\", stdout);
        } else if (text[i] == '\n') {
            fputs("\\n", stdout);
        } else if (text[i] == '\r') {
            fputs("\\r", stdout);
        } else if (text[i] == '\t') {
            fputs("\\t", stdout);
        } else {
            fputc(text[i], stdout);
        }
        i++;
    }
}
static void json_print_string(char *text) {
    fputc('"', stdout);
    json_escape(text);
    fputc('"', stdout);
}
static void json_field(char *name, char *value) {
    printf(",\"%s\":", name);
    if (value == NULL) {
        fputs("null", stdout);
        return;
    }
    json_print_string(value);
}
static void json_number(char *name, long value) {
    printf(",\"%s\":%ld", name, value);
}
static void json_number_or_null(char *name, char *value) {
    printf(",\"%s\":", name);
    if (value == NULL) {
        fputs("null", stdout);
        return;
    }
    printf("%ld", atol(value));
}
static void json_row_separator(int *first_row) {
    if (*first_row == 1) {
        *first_row = 0;
        return;
    }
    fputc(',', stdout);
}
static void json_end_list(void) {
    fputc(']', stdout);
}
static void copy_text_bounded(char *target, char *value, int room) {
    int used = 0;
    if (value == NULL) {
        target[0] = '\0';
        return;
    }
    while (value[used] != '\0') {
        if (used >= room - 1) break;
        target[used] = value[used];
        used++;
    }
    target[used] = '\0';
}
#endif
