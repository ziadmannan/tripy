#!/bin/bash

export ANTHROPIC_BASE_URL="https://generativelanguage.googleapis.com/v1beta/openai/"
export ANTHROPIC_AUTH_TOKEN="AIzaSyBW9f7gLSvw7BuheNkgIsLc2-qFrsGfnHE"
export ANTHROPIC_API_KEY="AIzaSyBW9f7gLSvw7BuheNkgIsLc2-qFrsGfnHE"
export ANTHROPIC_MODEL=gemini-2.5-flash

# Default: resume existing session. Pass --new to start fresh.
if [ "$1" = "--new" ]; then
  claude
else
  claude --resume
fi
