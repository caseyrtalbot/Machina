# thought-engine block-protocol hook for bash.
#
# Emits OSC 1337; te- markers around each prompt and command. See
# docs/architecture/block-protocol.md for the wire format.
#
# Install: append `[ -f ~/.te.bash ] && source ~/.te.bash` to ~/.bashrc.
# Or run "Set up shell hooks" from the thought-engine canvas command palette.

if [ -n "${__TE_HOOK_LOADED:-}" ]; then
  return 0 2>/dev/null || true
fi
__TE_HOOK_LOADED=1

__te_active() {
  [ -n "${TE_SESSION_ID:-}" ]
}

__te_now_ms() {
  if [ -n "${EPOCHREALTIME:-}" ]; then
    # bash 5+: EPOCHREALTIME = sec.microsec
    local s=${EPOCHREALTIME%.*}
    local us=${EPOCHREALTIME#*.}
    printf '%s' "$(( s * 1000 + 10#${us:0:6} / 1000 ))"
  else
    printf '%s' "$(( $(date +%s) * 1000 ))"
  fi
}

__te_emit() {
  __te_active || return 0
  printf '\033]1337;%s\007' "$1"
}

# Run before each prompt is rendered.
__te_prompt_command() {
  local exit_code=$?
  if [ -n "${__TE_COMMAND_RUNNING:-}" ]; then
    __te_emit "te-command-end;exit=${exit_code};ts=$(__te_now_ms)"
    unset __TE_COMMAND_RUNNING
  fi
  __te_emit "te-prompt-start"
}

# DEBUG trap fires before each command in the prompt's command line.
__te_debug_trap() {
  # Don't fire inside PROMPT_COMMAND itself.
  [ -n "${COMP_LINE:-}" ] && return 0
  [ "${BASH_COMMAND}" = "__te_prompt_command" ] && return 0
  if [ -z "${__TE_COMMAND_RUNNING:-}" ]; then
    __TE_COMMAND_RUNNING=1
    local cwd=${PWD//;/%3B}
    __te_emit "te-command-start;cwd=${cwd};ts=$(__te_now_ms);shell=bash"
  fi
}

# Compose with any existing PROMPT_COMMAND.
case ";${PROMPT_COMMAND:-};" in
  *";__te_prompt_command;"*) ;;
  *) PROMPT_COMMAND="__te_prompt_command${PROMPT_COMMAND:+;$PROMPT_COMMAND}" ;;
esac

trap '__te_debug_trap' DEBUG
