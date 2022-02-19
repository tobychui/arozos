@echo off
set /p id="Enter a release version (e.g. v0.0.1) :"
git tag "%id%"
git push origin "%id%"