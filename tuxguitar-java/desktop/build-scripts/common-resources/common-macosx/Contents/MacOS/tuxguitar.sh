#!/bin/sh
##dark mode
getTheme() {
    if defaults read -g AppleInterfaceStyle 2>/dev/null | grep -q "Dark"; then
        echo "dark"
    else
        echo "light"
    fi
}

##SCRIPT DIR
TG_DIR=`dirname "$0"`
TG_DIR=`cd "$TG_DIR"; pwd`
cd "${TG_DIR}"
##JAVA
# Prefer a JRE bundled inside the .app; otherwise fall back to system Java.
if [ -x "./jre/bin/java" ]; then
    JAVA="./jre/bin/java"
elif [ -n "${JAVA_HOME}" ] && [ -x "${JAVA_HOME}/bin/java" ]; then
    JAVA="${JAVA_HOME}/bin/java"
elif JH=`/usr/libexec/java_home 2>/dev/null` && [ -x "${JH}/bin/java" ]; then
    JAVA="${JH}/bin/java"
elif command -v java >/dev/null 2>&1; then
    JAVA="java"
else
    osascript -e 'display alert "TuxGuitar cannot start" message "No Java runtime found. Install a JDK (e.g. brew install openjdk) or bundle a JRE inside the app." as critical' >/dev/null 2>&1
    echo "TuxGuitar: no Java runtime found (no bundled ./jre/bin/java and no system Java)." >&2
    exit 1
fi
##LIBRARY_PATH
LD_LIBRARY_PATH=${LD_LIBRARY_PATH}:${TG_DIR}/lib/
##CLASSPATH
CLASSPATH=${CLASSPATH}:${TG_DIR}/lib/*
CLASSPATH=${CLASSPATH}:${TG_DIR}/share/
CLASSPATH=${CLASSPATH}:${TG_DIR}/dist/
##MAINCLASS
MAINCLASS=app.tuxguitar.app.TGMainSingleton
##SWT ARGUMENTS
ls lib/*swt*.jar > /dev/null 2>&1 && SWT_ARGS="-XstartOnFirstThread"
##EXPORT VARS
export CLASSPATH
export LD_LIBRARY_PATH
##LAUNCH
"${JAVA}" ${SWT_ARGS} -cp ":${CLASSPATH}" -Dtuxguitar.home.path="${TG_DIR}" -Djava.library.path="${LD_LIBRARY_PATH}" -Dtuxguitar.theme=$(getTheme) ${MAINCLASS} "$@"
