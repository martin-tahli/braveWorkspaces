#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

provider_arg=""
model_arg=""
env_file_arg=""
select_mode="auto"
list_mode=0
claude_args=()

usage() {
  cat <<'USAGE'
Usage:
  ./claude-provider.sh [options] [--] [claude args...]

Options:
  --provider NAME    Provider profile: openrouter, zai, custom
  --model MODEL      Model ID to use for Haiku/Sonnet/Opus defaults
  --env-file FILE    Env file to source before selecting provider
  --select           Force provider/model picker
  --no-select        Use defaults without prompting
  --list             Print provider profiles and exit
  -h, --help         Show this help

Defaults can be set in .env.claude-providers.local:
  CLAUDE_PROVIDER=openrouter
  CLAUDE_MODEL=nex-agi/nex-n2-pro:free

With no provider/model flags, the picker opens by default on interactive terminals.
USAGE
}

die() {
  echo "claude-provider: $*" >&2
  exit 1
}

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

split_csv() {
  local input="$1"
  local -n output_ref="$2"
  local item
  output_ref=()
  IFS=',' read -r -a raw_items <<< "$input"
  for item in "${raw_items[@]}"; do
    item="$(trim "$item")"
    [[ -n "$item" ]] && output_ref+=("$item")
  done
}

print_providers() {
  cat <<'PROVIDERS'
Providers:
  openrouter  Anthropic-compatible Claude Code endpoint via OpenRouter
  zai         Z.ai Anthropic-compatible endpoint
  custom      Use ANTHROPIC_* values from the selected env file
PROVIDERS
}

while (($#)); do
  case "$1" in
    --provider)
      [[ $# -ge 2 ]] || die "--provider needs a value"
      provider_arg="$2"
      shift 2
      ;;
    --provider=*)
      provider_arg="${1#*=}"
      shift
      ;;
    --model)
      [[ $# -ge 2 ]] || die "--model needs a value"
      model_arg="$2"
      shift 2
      ;;
    --model=*)
      model_arg="${1#*=}"
      shift
      ;;
    --env-file)
      [[ $# -ge 2 ]] || die "--env-file needs a value"
      env_file_arg="$2"
      shift 2
      ;;
    --env-file=*)
      env_file_arg="${1#*=}"
      shift
      ;;
    --select)
      select_mode=1
      shift
      ;;
    --no-select)
      select_mode=0
      shift
      ;;
    --list)
      list_mode=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      claude_args+=("$@")
      break
      ;;
    *)
      claude_args+=("$1")
      shift
      ;;
  esac
done

if ((list_mode)); then
  print_providers
  exit 0
fi

resolve_env_file() {
  local candidate

  if [[ -n "$env_file_arg" ]]; then
    [[ -f "$env_file_arg" ]] || die "missing env file: $env_file_arg"
    printf '%s' "$env_file_arg"
    return
  fi

  for candidate in \
    "${CLAUDE_PROVIDER_ENV_FILE:-}" \
    "${CLAUDE_ENV_FILE:-}" \
    "$project_root/.env.claude-providers.local" \
    "$project_root/.env.claude-openrouter.local" \
    "$project_root/.env.claude-zai.local"; do
    if [[ -n "$candidate" && -f "$candidate" ]]; then
      printf '%s' "$candidate"
      return
    fi
  done
}

env_file="$(resolve_env_file || true)"
if [[ -n "$env_file" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a
fi

choose_value() {
  local prompt="$1"
  local default_value="$2"
  shift 2
  local choices=("$@")
  local answer
  local i

  echo "$prompt" >&2
  for i in "${!choices[@]}"; do
    printf '  %d) %s\n' "$((i + 1))" "${choices[$i]}" >&2
  done
  printf 'Selection [%s]: ' "$default_value" >&2
  read -r answer
  answer="$(trim "$answer")"

  if [[ -z "$answer" ]]; then
    printf '%s' "$default_value"
  elif [[ "$answer" =~ ^[0-9]+$ && "$answer" -ge 1 && "$answer" -le "${#choices[@]}" ]]; then
    printf '%s' "${choices[$((answer - 1))]}"
  else
    printf '%s' "$answer"
  fi
}

provider="${provider_arg:-${CLAUDE_PROVIDER:-openrouter}}"
model="${model_arg:-${CLAUDE_MODEL:-}}"

if [[ "$select_mode" == "auto" ]]; then
  if [[ -z "$provider_arg" && -z "$model_arg" && -t 0 ]]; then
    select_mode=1
  else
    select_mode=0
  fi
fi

if ((select_mode)); then
  [[ -t 0 ]] || die "selection needs an interactive terminal"
  provider="$(choose_value "Provider:" "$provider" openrouter zai custom)"
fi

set_model_defaults() {
  local selected_model="$1"
  export ANTHROPIC_DEFAULT_HAIKU_MODEL="$selected_model"
  export ANTHROPIC_DEFAULT_SONNET_MODEL="$selected_model"
  export ANTHROPIC_DEFAULT_OPUS_MODEL="$selected_model"
}

require_value() {
  local name="$1"
  local value="$2"
  [[ -n "$value" ]] || die "$name is required for provider '$provider'"
}

configure_openrouter() {
  local selected_model
  local models
  local model_choices=()

  selected_model="${model:-${OPENROUTER_DEFAULT_MODEL:-nex-agi/nex-n2-pro:free}}"
  models="${OPENROUTER_MODELS:-nex-agi/nex-n2-pro:free,anthropic/claude-sonnet-4,openai/gpt-5.2,google/gemini-2.5-pro}"
  split_csv "$models" model_choices

  if ((select_mode)); then
    selected_model="$(choose_value "OpenRouter model:" "$selected_model" "${model_choices[@]}")"
  fi

  require_value "OPENROUTER_API_KEY" "${OPENROUTER_API_KEY:-}"
  export ANTHROPIC_BASE_URL="${OPENROUTER_BASE_URL:-https://openrouter.ai/api}"
  export ANTHROPIC_AUTH_TOKEN="$OPENROUTER_API_KEY"
  export ANTHROPIC_API_KEY=""
  set_model_defaults "$selected_model"
}

configure_zai() {
  local selected_model
  local auth_token
  local models
  local model_choices=()

  selected_model="${model:-${ZAI_DEFAULT_MODEL:-glm-5.1}}"
  models="${ZAI_MODELS:-glm-5.1,glm-4.5-air}"
  split_csv "$models" model_choices

  if ((select_mode)); then
    selected_model="$(choose_value "Z.ai model:" "$selected_model" "${model_choices[@]}")"
  fi

  auth_token="${ZAI_AUTH_TOKEN:-${ZAI_API_KEY:-${ANTHROPIC_AUTH_TOKEN:-}}}"
  require_value "ZAI_AUTH_TOKEN or ANTHROPIC_AUTH_TOKEN" "$auth_token"
  export ANTHROPIC_BASE_URL="${ZAI_BASE_URL:-https://api.z.ai/api/anthropic}"
  export ANTHROPIC_AUTH_TOKEN="$auth_token"
  unset ANTHROPIC_API_KEY
  set_model_defaults "$selected_model"
}

configure_custom() {
  local selected_model

  selected_model="$model"
  require_value "ANTHROPIC_BASE_URL" "${ANTHROPIC_BASE_URL:-}"
  if [[ -z "${ANTHROPIC_AUTH_TOKEN:-}" && -z "${ANTHROPIC_API_KEY:-}" ]]; then
    die "ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY is required for provider 'custom'"
  fi

  if ((select_mode)); then
    selected_model="$(choose_value "Custom model:" "${selected_model:-${ANTHROPIC_DEFAULT_SONNET_MODEL:-}}" "${selected_model:-${ANTHROPIC_DEFAULT_SONNET_MODEL:-}}")"
  fi

  [[ -n "$selected_model" ]] && set_model_defaults "$selected_model"
}

case "$provider" in
  openrouter)
    configure_openrouter
    ;;
  zai|z.ai)
    provider="zai"
    configure_zai
    ;;
  custom)
    configure_custom
    ;;
  *)
    die "unknown provider '$provider'. Use --list to see profiles."
    ;;
esac

echo "claude-provider: env=${env_file:-none} provider=$provider model=${ANTHROPIC_DEFAULT_SONNET_MODEL:-unchanged}" >&2
exec "${CLAUDE_COMMAND:-claude}" "${claude_args[@]}"
