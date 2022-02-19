requirelib("http");
requirelib("imagelib");

function main(){
    //Download stock image for testing from 
    //https://cdn.pixabay.com/photo/2017/03/28/12/10/chairs-2181947_960_720.jpg
    http.download("https://cdn.pixabay.com/photo/2017/03/28/12/10/chairs-2181947_960_720.jpg", "tmp:/", "classify.jpg");

    //Get image classification, will take a bit time
    var results = imagelib.classify("tmp:/classify.jpg", "darknet19"); 
    var responses = [];
    for (var i = 0; i < results.length; i++){
        responses.push({
            "object": results[i].Name,
            "confidence": results[i].Percentage,
            "position_x": results[i].Positions[0],
            "position_y": results[i].Positions[1],
            "width": results[i].Positions[2],
            "height": results[i].Positions[3]
        });
    }

    sendJSONResp(JSON.stringify(responses));
}

main();
