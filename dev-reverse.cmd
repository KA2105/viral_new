@echo off
adb reverse tcp:4000 tcp:4000
adb reverse tcp:8081 tcp:8081
echo ✅ adb reverse OK (4000, 8081)
pause
