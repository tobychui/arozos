#!/bin/bash
echo Enter commit notes:
read commitmsg
git pull
git add *
git commit -m "$commitmsg"
git push