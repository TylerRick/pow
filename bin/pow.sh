#! /usr/bin/env bash

# detects the correct path of current script
cd `dirname $0`
POW_ROOT=`dirname $(pwd -P)`

POW_BIN="$POW_ROOT/bin/`basename $0`"
NODE_PATH="$POW_ROOT/node_modules:$NODE_PATH"

export NODE_PATH POW_BIN

# loads RVM if available
[ -f ~/.rvm/scripts/rvm ] && source ~/.rvm/scripts/rvm

# kills any running instance
PID=`ps x | awk -F " " "{ if ( \\$5 == \\"$POW_ROOT/bin/node\\" && \\$6 == \\"$POW_ROOT/lib/command.js\\" ) print \\$1 }"`
[ "$PID" == "" ] || kill $PID

# starts instance
exec "$POW_ROOT/bin/node" "$POW_ROOT/lib/command.js"

