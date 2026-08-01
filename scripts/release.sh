#!/bin/bash
# Release script for Human OS
# Usage: ./scripts/release.sh [version]
# If no version provided, uses today's date (vYYYY.MM.DD)

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

echo "🚀 Creating release: $VERSION"
echo ""

# Check if tag already exists
if git tag | grep -q "^${VERSION}$"; then
    echo "❌ Tag $VERSION already exists!"
    echo "   Use a different version or delete the existing tag:"
    echo "   git tag -d $VERSION"
    echo "   git push origin :refs/tags/$VERSION"
    exit 1
fi

# Check for uncommitted changes
if ! git diff-index --quiet HEAD --; then
    echo "⚠️  You have uncommitted changes. Please commit or stash them first."
    git status
    exit 1
fi

# Run tests first
echo "🧪 Running tests..."
if ! npm run test -- --run; then
    echo "❌ Tests failed! Fix them before releasing."
    exit 1
fi

echo ""
echo "✅ All tests passed!"

# Ask for confirmation
echo ""
read -p "Create and push tag $VERSION? (y/n) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🏷️  Creating tag..."
    git tag -a "$VERSION" -m "Release $VERSION"
    
    echo "📤 Pushing tag to origin..."
    git push origin "$VERSION"
    
    echo ""
    echo "🎉 Done! GitHub Actions will now:"
    echo "   1. Build the APK"
    echo "   2. Create release notes"
    echo "   3. Publish the release at: https://github.com/anurag008w/jee-human-os/releases/tag/$VERSION"
else
    echo "❌ Cancelled."
fi
