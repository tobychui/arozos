import os, sys, yaml, json
for (dirpath,dirnames,filenames) in os.walk('.'):
    #print(dirpath + filenames)
    for i in filenames:
        print(dirpath + "\\" +  i)
        if "yml" in i:
            json.dump(yaml.load(open(dirpath + "\\" +  i,encoding="utf8")), open(dirpath + "\\" + i.replace("yml","json"),"w",encoding="utf8"), indent=4)
