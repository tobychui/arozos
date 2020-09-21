# ArOZ Online System Utilities

## Introduction to License usage in system utilities
In the ArOZ Online Beta implementation, only MIT, apache 2.0 and public domain licenses are allowed.
In the ArOZ Online 1.0 version, GPL and AGPL libraries are allowed **IF AND ONLY IF** the library is not modified.

## Requirement of releasing source code to the public
See more at : https://www.gnu.org/licenses/gpl-faq.en.html#GPLRequireSourcePostedPublic

In simple words, as soon as you are not modifying the library, you need not to release the source code to the public.


```
Does the GPL require that source code of modified versions be posted to the public? (#GPLRequireSourcePostedPublic)

The GPL does not require you to release your modified version, or any part of it. You are free to make modifications and use them privately, without ever releasing them. This applies to organizations (including companies), too; an organization can make a modified version and use it internally without ever releasing it outside the organization.
But if you release the modified version to the public in some way, the GPL requires you to make the modified source code available to the program's users, under the GPL.
Thus, the GPL gives permission to release the modified program in certain ways, and not in other ways; but the decision of whether to release it is up to you.
```

## Guide for using GPL / AGPL library in ArOZ Online System
As ArOZ Online System are designed to be ALL RIGHT RESERVED by the imuslab, here are the guideline to help you make a clear cut of the area of open source vs close source:

1. Download the library and unzip it **WITH ITS PARENT FOLDERNAME**
2. Unzip the library only in ./script folders and include the license inside the library folder root
3. **DO NOT CHANGE ANY LINES WITHIN THE LIBRARY**
4. Wrap the page that use the library in iframe if possible.
