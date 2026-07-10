import { HARNESS_PROTECTED_GLOBS } from '../harness-types'

export const HARNESS_MEMORY_GLOBS = ['<dir>/state.md', '<dir>/handoffs/**'] as const

export const BASE_FORBIDDEN_GLOBS = [...HARNESS_PROTECTED_GLOBS, '.git/**', '.env*'] as const

export const NO_CODE_FORBIDDEN_GLOBS = [
  ...BASE_FORBIDDEN_GLOBS,
  'src/**',
  'test/**',
  'tests/**',
  '**/__tests__/**',
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'Cargo.toml',
  'Cargo.lock',
  'pyproject.toml'
] as const

export const DEFAULT_ROLLBACK =
  'For Git-backed changes captured by Machina, reject the pending change or revert its Machina-Agent commits. External side effects and uncaptured or deleted untracked data may not be recoverable.'

const BASE_RULES = [
  '- [critical] Never edit, chmod, or delete verify.sh or rules.md in any .machina/agents/ or .machina-dev/agents/ directory.',
  '- [critical] If the concrete task input named by this skill is missing, ask one focused question and do not inspect or write until it is answered.',
  '- [critical] Git is read-only: use status, diff, log, show, ls-files, grep, or blame; never add, commit, checkout, switch, restore, reset, clean, merge, rebase, stash, tag, or push.',
  '- [critical] Never touch files matching forbiddenGlobs in scope.json.',
  '- [major] Scope globs are instructions, not a sandbox: writes reach disk before review and must still be reviewed in the approvals tray.',
  '- [major] Stay inside allowedGlobs; if a prerequisite or safe verification needs wider access, report the blocker and stop without widening scope.',
  '- [major] Stop as soon as the named task is complete.',
  '- [minor] Record durable repository facts in the harness-local state.md path listed in allowedGlobs before stopping.'
] as const

export function rulesFor(...specific: readonly string[]): string {
  return [...BASE_RULES, ...specific].join('\n')
}

export function verifyScript(command: string): string {
  return ['#!/bin/sh', 'set -eu', 'cd "$(dirname "$0")/../../.."', command, ''].join('\n')
}

export interface ArtifactPattern {
  /** Extended, case-insensitive grep pattern required in a changed artifact. */
  readonly regex: string
  readonly description: string
}

export interface ArtifactRequirement {
  readonly label: string
  /** Git pathspecs, interpreted from the workspace root. */
  readonly pathspecs: readonly string[]
  readonly minNonEmpty?: number
  readonly maxNonEmpty?: number
  readonly patterns?: readonly ArtifactPattern[]
}

export interface ArtifactVerifierOptions {
  readonly requirements: readonly ArtifactRequirement[]
  /** Syntax-check only changed shell scripts, using their declared shell when recognizable. */
  readonly shellSyntaxPathspecs?: readonly string[]
}

export interface HarnessLocalArtifactVerifierOptions {
  /** Harness-directory-relative artifact path. */
  readonly relativePath: string
  /** Harness-directory-relative checksum marker, updated only after all checks pass. */
  readonly markerPath: string
  readonly label: string
  readonly patterns: readonly ArtifactPattern[]
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

const ARTIFACT_VERIFIER_PREAMBLE = [
  '#!/bin/sh',
  'set -eu',
  '_script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)',
  '_repo_root=$(CDPATH= cd -- "$_script_dir/../../.." && pwd -P)',
  'cd "$_repo_root"',
  'fail() { printf "%s\\n" "$1" >&2; exit 1; }',
  'assert_no_symlink_components() {',
  '  _ans_path=$1',
  '  [ ! -L "$_ans_path" ] || fail "Verification artifact must not be a symlink: $_ans_path"',
  '  _ans_parent=$(dirname -- "$_ans_path")',
  '  while [ "$_ans_parent" != "." ] && [ "$_ans_parent" != "/" ]; do',
  '    [ ! -L "$_ans_parent" ] || fail "Verification artifact parent must not be a symlink: $_ans_parent"',
  '    _ans_parent=$(dirname -- "$_ans_parent")',
  '  done',
  '}',
  'changed_files() {',
  '  {',
  '    git diff --name-only --diff-filter=ACMR -- "$@"',
  '    git diff --cached --name-only --diff-filter=ACMR -- "$@"',
  '    git ls-files --others --exclude-standard -- "$@"',
  '  } | LC_ALL=C sort -u',
  '}',
  'check_changes() {',
  '  _cc_changes=$(changed_files "$@")',
  '  [ -n "$_cc_changes" ] || return 1',
  '  while IFS= read -r _cc_file; do',
  '    assert_no_symlink_components "$_cc_file"',
  '  done <<EOF',
  '$_cc_changes',
  'EOF',
  '  git diff --check -- "$@"',
  '  git diff --cached --check -- "$@"',
  '  _cc_untracked=$(git ls-files --others --exclude-standard -- "$@")',
  '  if [ -n "$_cc_untracked" ]; then',
  '    while IFS= read -r _cc_file; do',
  '      [ -f "$_cc_file" ] || continue',
  '      _cc_output=$(git diff --no-index --check -- /dev/null "$_cc_file" 2>&1 || :)',
  '      if [ -n "$_cc_output" ]; then',
  '        printf "%s\\n" "$_cc_output" >&2',
  '        return 1',
  '      fi',
  '    done <<EOF',
  '$_cc_untracked',
  'EOF',
  '  fi',
  '}',
  'changed_nonempty_count() {',
  '  _cnc_changes=$(changed_files "$@")',
  '  _cnc_count=0',
  '  if [ -n "$_cnc_changes" ]; then',
  '    while IFS= read -r _cnc_file; do',
  '      if [ -f "$_cnc_file" ] && [ -s "$_cnc_file" ]; then',
  '        _cnc_count=$((_cnc_count + 1))',
  '      fi',
  '    done <<EOF',
  '$_cnc_changes',
  'EOF',
  '  fi',
  '  printf "%s\\n" "$_cnc_count"',
  '}',
  'changed_contains_pattern() {',
  '  _ccp_pattern=$1',
  '  shift',
  '  _ccp_changes=$(changed_files "$@")',
  '  [ -n "$_ccp_changes" ] || return 1',
  '  while IFS= read -r _ccp_file; do',
  '    if [ -f "$_ccp_file" ] && [ -s "$_ccp_file" ] && grep -Eiq "$_ccp_pattern" "$_ccp_file"; then',
  '      return 0',
  '    fi',
  '  done <<EOF',
  '$_ccp_changes',
  'EOF',
  '  return 1',
  '}',
  'check_changed_shell_syntax() {',
  '  _css_changes=$(changed_files "$@")',
  '  [ -n "$_css_changes" ] || return 0',
  '  while IFS= read -r _css_file; do',
  '    assert_no_symlink_components "$_css_file"',
  '    [ -f "$_css_file" ] || continue',
  '    case "$(head -n 1 "$_css_file")" in',
  '      *bash*) bash -n "$_css_file" ;;',
  '      *) sh -n "$_css_file" ;;',
  '    esac',
  '  done <<EOF',
  '$_css_changes',
  'EOF',
  '}'
] as const

/**
 * Build an executable gate that observes staged, unstaged, and untracked artifacts.
 * Scope remains advisory: this proves named outputs, not containment of every write.
 */
export function artifactVerifierScript(options: ArtifactVerifierOptions): string {
  const lines: string[] = [...ARTIFACT_VERIFIER_PREAMBLE]

  for (const requirement of options.requirements) {
    const args = requirement.pathspecs.map(shellQuote).join(' ')
    const min = requirement.minNonEmpty ?? 1
    lines.push(
      `check_changes ${args} || fail ${shellQuote(`No current ${requirement.label} change was found.`)}`,
      `_artifact_count=$(changed_nonempty_count ${args})`,
      `[ "$_artifact_count" -ge ${min} ] || fail ${shellQuote(`Expected at least ${min} non-empty ${requirement.label} artifact(s).`)}`
    )
    if (requirement.maxNonEmpty !== undefined) {
      lines.push(
        `[ "$_artifact_count" -le ${requirement.maxNonEmpty} ] || fail ${shellQuote(`Expected at most ${requirement.maxNonEmpty} non-empty ${requirement.label} artifact(s).`)}`
      )
    }
    for (const pattern of requirement.patterns ?? []) {
      lines.push(
        `changed_contains_pattern ${shellQuote(pattern.regex)} ${args} || fail ${shellQuote(`Changed ${requirement.label} artifacts must include ${pattern.description}.`)}`
      )
    }
  }

  if (options.shellSyntaxPathspecs !== undefined) {
    const args = options.shellSyntaxPathspecs.map(shellQuote).join(' ')
    lines.push(
      `check_changed_shell_syntax ${args} || fail 'A changed shell automation has invalid syntax.'`
    )
  }

  lines.push("printf '%s\\n' 'Harness verification passed.'", '')
  return lines.join('\n')
}

/**
 * Verify an ignored harness-local report without pretending Git can attribute it.
 * A private checksum marker proves the report changed since the previous successful gate.
 */
export function harnessLocalArtifactVerifierScript(
  options: HarnessLocalArtifactVerifierOptions
): string {
  const lines: string[] = [
    ...ARTIFACT_VERIFIER_PREAMBLE,
    'case "$_script_dir/" in',
    '  "$_repo_root/"*) _harness_rel=${_script_dir#"$_repo_root/"} ;;',
    "  *) fail 'Harness directory is outside the repository root.' ;;",
    'esac',
    `_artifact_path="$_harness_rel/${options.relativePath}"`,
    `_marker_path="$_harness_rel/${options.markerPath}"`,
    'assert_no_symlink_components "$_artifact_path"',
    'assert_no_symlink_components "$_marker_path"',
    `[ -f "$_artifact_path" ] && [ -s "$_artifact_path" ] || fail ${shellQuote(`${options.label} is missing or empty.`)}`,
    'file_digest() {',
    '  if command -v sha256sum >/dev/null 2>&1; then',
    '    sha256sum "$1" | awk \'{print $1}\'',
    '  elif command -v shasum >/dev/null 2>&1; then',
    '    shasum -a 256 "$1" | awk \'{print $1}\'',
    '  else',
    '    cksum "$1" | awk \'{print $1 ":" $2}\'',
    '  fi',
    '}',
    '_artifact_digest=$(file_digest "$_artifact_path")',
    'if [ -f "$_marker_path" ]; then',
    '  _previous_digest=$(cat "$_marker_path")',
    `  [ "$_artifact_digest" != "$_previous_digest" ] || fail ${shellQuote(`${options.label} is unchanged since its last successful verification.`)}`,
    'fi'
  ]

  for (const pattern of options.patterns) {
    lines.push(
      `grep -Eiq ${shellQuote(pattern.regex)} "$_artifact_path" || fail ${shellQuote(`${options.label} must include ${pattern.description}.`)}`
    )
  }

  lines.push(
    '_marker_tmp=$(mktemp "${_marker_path}.tmp.XXXXXX") || fail "Could not create a private verification marker."',
    'trap \'rm -f "$_marker_tmp"\' EXIT HUP INT TERM',
    `(umask 077; printf '%s\\n' "$_artifact_digest" > "$_marker_tmp")`,
    'mv "$_marker_tmp" "$_marker_path"',
    'trap - EXIT HUP INT TERM',
    `printf '%s\\n' ${shellQuote(`${options.label} changed since its last successful verification; this is not current-turn attribution.`)}`,
    ''
  )
  return lines.join('\n')
}

export function initialStateFor(subject: string): string {
  return [
    '# Repo memory',
    '',
    'No runs recorded yet.',
    `For ${subject} runs, append only durable repository-specific findings.`,
    ''
  ].join('\n')
}
