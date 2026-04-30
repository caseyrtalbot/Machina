# thought-engine block-protocol hook for fish.
#
# Emits OSC 1337; te- markers around each prompt and command. See
# docs/architecture/block-protocol.md for the wire format.
#
# Install: copy this file to ~/.config/fish/conf.d/te.fish, or run
# "Set up shell hooks" from the thought-engine canvas command palette.

if set -q __TE_HOOK_LOADED
    exit 0
end
set -g __TE_HOOK_LOADED 1

function __te_active
    set -q TE_SESSION_ID
end

function __te_now_ms
    # fish has no built-in nanos; shell out once.
    date +%s%3N 2>/dev/null
    or printf '%s' (math (date +%s) "*" 1000)
end

function __te_emit
    __te_active; or return 0
    printf '\033]1337;%s\007' $argv[1]
end

# Fires when fish has just finished running a command and is about to print
# the prompt. The previous command's exit code is in $status.
function __te_fish_postexec --on-event fish_postexec
    set -l exit_code $status
    if set -q __TE_COMMAND_RUNNING
        __te_emit "te-command-end;exit=$exit_code;ts="(__te_now_ms)
        set -e __TE_COMMAND_RUNNING
    end
    __te_emit "te-prompt-start"
end

# Fires right before a command runs, after the user pressed Enter.
function __te_fish_preexec --on-event fish_preexec
    set -g __TE_COMMAND_RUNNING 1
    set -l cwd (string replace -a ';' '%3B' -- $PWD)
    __te_emit "te-command-start;cwd=$cwd;ts="(__te_now_ms)";shell=fish"
end

# Emit an initial prompt-start so the very first prompt forms a block.
__te_emit "te-prompt-start"
