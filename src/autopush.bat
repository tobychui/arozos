@echo off
set /p id="Enter commit notes: "
git pull
git add *
git commit -m "%id%"
git push