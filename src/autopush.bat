@echo off
set /p id="Enter commit notes: "
git pull
git add -A
git commit -m "%id%"
git push