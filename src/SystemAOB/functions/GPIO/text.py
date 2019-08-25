from gpiozero import LED
from time import sleep
import os
print os.getpid()
led = LED(4)

while True:
    led.on()
    sleep(1)
    led.off()
    sleep(1)
