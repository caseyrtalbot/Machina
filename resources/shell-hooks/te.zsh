# thought-engine block-protocol hook for zsh.
#
# Emits OSC 1337; te- markers around each prompt and command so the engine
# can convert the raw PTY stream into structured Block records. See
# docs/architecture/block-protocol.md for the wire format.
#
# Install: append `[ -f ~/.te.zsh ] && source ~/.te.zsh` to ~/.zshrc.
# Or run "Set up shell hooks" from the thought-engine canvas command palette.
#
# Safe to source unconditionally: if the host shell isn't connected to a
# thought-engine PTY (i.e. TE_SESSION_ID is unset), the hooks no-op.

# Skip if already sourced in this shell.
if [[ -n "${__TE_HOOK_LOADED:-}" ]]; then
  return 0
fi
__TE_HOOK_LOADED=1

# Only emit markers when running under a thought-engine PTY.
__te_active() {
  [[ -n "${TE_SESSION_ID:-}" ]]
}

__te_now_ms() {
  # zsh date math is integer, so build epoch-ms from $EPOCHREALTIME (zsh/datetime).
  zmodload -e zsh/datetime || zmodload zsh/datetime 2>/dev/null
  if [[ -n "${EPOCHREALTIME:-}" ]]; then
    # EPOCHREALTIME = seconds.microseconds; multiply by 1000 to ms.
    print -- $(( ${EPOCHREALTIME%.*} * 1000 + ${EPOCHREALTIME#*.} / 1000 ))
  else
    print -- $(( $(date +%s) * 1000 ))
  fi
}

__te_emit() {
  __te_active || return 0
  printf '\033]1337;%s\007' "$1"
}

# Fired immediately before zsh prints the prompt.
__te_precmd() {
  local exit_code=$?
  if [[ -n "${__TE_COMMAND_RUNNING:-}" ]]; then
    __te_emit "te-command-end;exit=${exit_code};ts=$(__te_now_ms)"
    unset __TE_COMMAND_RUNNING
  fi
  __te_emit "te-prompt-start"
}

# Fired after the user hits Enter, before the command runs.
__te_preexec() {
  __TE_COMMAND_RUNNING=1
  local cwd
  cwd=${PWD//;/%3B}
  __te_emit "te-command-start;cwd=${cwd};ts=$(__te_now_ms);shell=zsh"
}

# zsh's hook arrays.
typeset -ga precmd_functions preexec_functions
precmd_functions=(${precmd_functions[@]:#__te_precmd} __te_precmd)
preexec_functions=(${preexec_functions[@]:#__te_preexec} __te_preexec)
