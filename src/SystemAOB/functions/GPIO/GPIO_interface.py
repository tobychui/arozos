#ArOZ Online System PHP to Raspberry Pi GPIO Interface program
#CopyRight IMUS Laboratory and the developers involved into this project.
import sys
import os
from gpiozero import LED
from time import sleep
usablePins = [4,17,18,27,22,23,24,25,5,6,12,13,19,16,26,20,21]
if (len(sys.argv) < 3):
	print("Too little arguments. GPIO_interface.py <GPIO number> <status (0/1)>")
	sys.exit()
elif (len(sys.argv) > 3):
	print("Too much arguments.")
	sys.exit()
gpio = sys.argv[1]
status = sys.argv[2]
processID = os.getpid()
if (int(gpio) not in usablePins):
	print("Not a correct pin number.")
	sys.exit()
logfile = open("process/" + str(processID) + ".log","w")
logfile.write(str(processID) + "," + str(gpio) + "," + str(status))
logfile.close()
led=LED(int(gpio))

while True:
	if (int(status) == 1):
		led.on()
	else:
		led.off()
	sleep(1)
