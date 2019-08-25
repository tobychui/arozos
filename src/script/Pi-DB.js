//Pi-DB Access Library
class PiDB{
	//dbn -> Store the name of the database
	//DBpath -> Store the path of the db
	constructor(PiDBpath, dbname) {
		if (PiDBpath.slice(-1) != "/"){
			PiDBpath += "/";
		}
		this.dbn = dbname;
		this.DBpath = PiDBpath;
	}
	
	request(query){
	//Request Data from the PiDB System with the given query
	//console.log(this.DBpath + "table_r.php");
	//console.log(this.dbn);
	return $.ajax({
      url: this.DBpath + "/table_r.php",
      type: "get",
      data: {db:this.dbn,opr:query}  
    }); 
	}
	
	write(query){
		//Writing data to the PiDB
		return $.ajax({
		  url: this.DBpath + "/table_w.php",
		  type: "get",
		  data: {db:this.dbn,opr:query}  
		});
	}
	
	newDB(){
		//Creating a new database
		var oprs = 'newDB';
		return $.ajax({
		  url: this.DBpath + "/DB_operation.php",
		  type: "get",
		  data: {db:this.dbn,opr:oprs}  
		});
	}
	
	
	newTable(names,headers){
		//Creating a new table inside the current DB
		var oprs = 'createTable';
		return $.ajax({
		  url: this.DBpath + "/table_w.php",
		  type: "get",
		  data: {db:this.dbn,opr:oprs,name:names,header:headers}
		});
	}
	
}



