package fspermission

import (
	"errors"
	"fmt"
	"log"
	"os"
	"strconv"
)

/*
	This module handle functions realted to local file system permission.
	Only enabling when the system is run with sudo mode

*/

func GetFilePermissions(file string) (string, error) {
	fileStat, err := os.Stat(file)
	if err != nil {
		return "", err
	}

	permission := "0000"
	permission = fmt.Sprintf("%04o", fileStat.Mode().Perm())
	return permission, nil
}

func SetFilePermisson(file string, permissionKey string) error {
	mode := os.FileMode(0644)
	if len(permissionKey) != 4 {
		return errors.New("Invalid File Node")
	}

	finalMode := 0
	for i := 0; i < len(permissionKey); i++ {
		thisInt, err := strconv.Atoi(string(permissionKey[i]))
		if err != nil {
			return errors.New("Failed to parse permission key")
		}
		if i == 0 {
			if thisInt != 0 {
				return errors.New("Failed to parse permission key")
			}
		} else if i == 1 {
			if thisInt > 7 {
				return errors.New("Failed to parse permission key: Permission value > 7")
			} else {
				finalMode = finalMode + thisInt*100
			}
		} else if i == 2 {
			if thisInt > 7 {
				return errors.New("Failed to parse permission key: Permission value > 7")
			} else {
				finalMode = finalMode + thisInt*10
			}
		} else if i == 3 {
			if thisInt > 7 {
				return errors.New("Failed to parse permission key: Permission value > 7")
			} else {
				finalMode = finalMode + thisInt
			}
		}
	}

	//Convert the value into a file mode
	log.Println("Updating " + file + " permission to " + strconv.Itoa(finalMode))

	//Magic way to convert dec to oct
	output, _ := strconv.ParseInt("0"+strconv.Itoa(finalMode), 8, 64)
	mode = os.FileMode(output)

	//Set its mode
	err := os.Chmod(file, mode)
	if err != nil {
		return err
	}
	return nil
}
