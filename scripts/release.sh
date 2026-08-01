#!/bin/bash
# Release script for Human OS
# Usage: ./scripts/release.sh [version]
# If no version provided, uses today's date (vYYYY.MM.DD)
#
# IMPORTANT: Release is ONLY manual via GitHub Actions!
# This script just checks prerequisites.

set -e

# Get version from argument or generate from date
if [ -n "$1" ]; then
    VERSION="$1"
else
    VERSION="v$(date +%Y.%m.%d)"
fi

# Ensure version starts with 'v'
if [[ ! "$VERSION" =~ ^v ]]; then
    VERSION="v$VERSION"
fi

echo "🚀 Release Version: $VERSION"
echo ""

# Check if on main branch
BRANCH=$(git branch --show-current)
if [[ "$BRANCH" != "main" ]]; then
    echo "❌ You must be on 'main' branch to release!"
    echo "   Current branch: $BRANCH"
    exit 1
fi
echo "✅ On main branch"

# Check for uncommitted changes
if ! git diff-index --quiet HEAD --; then
    echo "⚠️  You have uncommitted changes!"
    git status --short
    echo ""
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Pull latest
echo "📥 Pulling latest changes..."
git pull origin main

# Run tests first
echo ""
echo "🧪 Running tests..."
if ! npm run test -- --run; then
    echo "❌ Tests failed! Fix them before releasing."
    exit 1
fi

echo ""
echo "✅ All tests passed!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📋 To create release:"
echo ""
echo "   1. Go to GitHub Actions:"
echo "      https://github.com/anurag008w/jee-human-os/actions"
echo ""
echo "   2. Click 'Release' workflow"
echo ""
echo "   3. Click 'Run workflow'"
echo ""
echo "   4. Enter version: $VERSION"
echo ""
echo "   5. Click 'Run workflow'"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "💡 Or use GitHub CLI:"
echo "   gh workflow run release.yml -f version=$VERSION"
