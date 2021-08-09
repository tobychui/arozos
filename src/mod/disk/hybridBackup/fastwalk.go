package hybridBackup

import (
	"io/ioutil"
	"os"
	"path/filepath"
)

/*
	High speed file walk function with no file stats
*/
func fastWalk(root string, walkFunc func(string) error) error {
	return walkDir(root, walkFunc)
}

func walkDir(dir string, walkFunc func(string) error) error {
	files, err := ioutil.ReadDir(dir)
	if err != nil {
		return err
	}

	for _, f := range files {
		if f.IsDir() {
			err := walkDir(filepath.Join(dir, f.Name()), walkFunc)
			if err != nil {
				return err
			}
		} else if !f.IsDir() {
			err := walkFunc(filepath.Join(dir, f.Name()))
			if err != nil {
				return err
			}
		}
	}

	return nil
}

func fileExists(filename string) bool {
	if _, err := os.Stat(filename); os.IsNotExist(err) {
		return false
	}
	return true
}
