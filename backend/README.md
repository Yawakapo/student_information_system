# Native backend: the C layer

The web application runs on the Node.js server in `server/`. That server stays
the public API, the authentication layer, and the owner of every database write
that has to be safe. The programs in this folder are the **C layer**: small,
read-only workers that answer one simple question each, straight from MySQL, and
print the answer as one line of JSON.

The Node.js server asks the C worker first. If the worker is missing, is slow, or
returns nothing usable, the server quietly runs the identical SQL query itself.
The page never breaks and never waits longer than before, because that behaviour
was already in place for the dashboard worker.

## The three live workers

| C source | Built program | One-line purpose | Used by |
| --- | --- | --- | --- |
| `dashboard.c` | `dashboard_counts.exe` | Count the students by enrolment status | Admin dashboard |
| `view_schedules.c` | `view_schedules.exe` | List every schedule in the timetable | View schedule page |
| `unassigned_students.c` | `unassigned_students.exe` | List the students who have no professor yet | View Students, "Assign Unassigned Students" |

Each one is read-only. None of them writes to the database, so none of them can
corrupt a record no matter what happens during a demonstration.

## How the two sides are kept honest

`server/services/nativeService.js` runs the program with `execFile`, gives it a
2500 ms timeout, reads the last non-empty line of its output, and parses it as
JSON. Anything that goes wrong returns `null`, which is the signal for the
controller to fall back to its own query.

The controllers then report which side answered in a response header, so the
answer can be seen without changing the JSON shape the pages already read:

```text
X-SIS-Schedule-Source: c-native-worker   or   nodejs-fallback
X-SIS-Student-Source:  c-native-worker   or   nodejs-fallback
```

The admin dashboard also reports it in the body as `metricsSource`.

Both paths were checked field by field against the same database, including the
cases where a professor is absent and the value has to stay a real `null` rather
than an empty string.

## Building the workers

`gcc` from MinGW and the MySQL client library are both already on this machine.
Nothing needs to be installed.

```powershell
$gcc = "C:\mingw64\bin\gcc.exe"
$inc = "C:/Program Files/MySQL/MySQL Server 8.0/include"
$lib = "C:/Program Files/MySQL/MySQL Server 8.0/lib"

foreach ($n in @('dashboard_counts', 'view_schedules', 'unassigned_students')) {
    $src = if ($n -eq 'dashboard_counts') { 'dashboard' } else { $n }
    & $gcc "backend/$src.c" -I"$inc" -Ibackend -L"$lib" -lmysql -o "backend/$n.exe"
}

foreach ($n in @('check_schedule', 'teachers_worker')) {
    & $gcc "backend/$n.c" -I"$inc" -Ibackend -L"$lib" -lmysql -o "backend/$n.exe"
}

```

### The schedule worker is built from four files

`schedule_worker.exe` is not one file. It is one program made of four sources that
are compiled together in a single command, which is why the output is still a
single `.exe` with a single name:

```powershell
& $gcc "backend/schedule_worker.c" "backend/schedule_list.c" "backend/schedule_save.c" "backend/schedule_delete.c" -I"$inc" -Ibackend -L"$lib" -lmysql -o "backend/schedule_worker.exe"
```

| file | what it holds |
| --- | --- |
| `schedule_worker.c` | reads the arguments and picks one of the three |
| `schedule_list.c` | the list |
| `schedule_save.c` | create and update |
| `schedule_delete.c` | delete and the class list cleanup |
| `schedule_db.h` | the rules all four use, written once |

Compiling any one of them on its own will fail, because the rules live in the
header they all include. They are always built as the four together.

The workers read their connection details from the same environment variables as
the Node.js server (`server/process.env`). No credentials are written into any
C file.

## Shared files

- `db_config.h` — the MySQL connection helper and the JSON string escaper
- `libmysql.dll` — the Windows MySQL client library the `.exe` files link to