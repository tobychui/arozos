/*
    Native.js

    This script is used to match the Music Player to as native as possible
    for some advanced use case (like PWA)
*/

//Native Media Player
function initNativeMediaPlayer(){
    var skipTime = 10;
    if ('mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler('play', function() {
            gainAudio();
            setPlaying(true);
        });
        navigator.mediaSession.setActionHandler('pause', function() { 
            originalVol = audioElement[0].volume;
            fadeAudio();
            setPlaying(false);
        });
        navigator.mediaSession.setActionHandler('stop', function() {
            originalVol = audioElement[0].volume;
            fadeAudio();
            setPlaying(false);
            audioElement[0].pause();
            setTimeout(function(){
                audioElement[0].volume = defaultVolumeBeforeFadeout;
            },500);
        });
        navigator.mediaSession.setActionHandler('seekbackward', function() {
            audioElementObject.currentTime = Math.max(audioElementObject.currentTime - skipTime, 0);
            setTimeout(function(){
                updatePositionState();
            }, 500);
        });
        navigator.mediaSession.setActionHandler('seekforward', function() {
            audioElementObject.currentTime = Math.min(audioElementObject.currentTime + skipTime, audioElementObject.duration);
            setTimeout(function(){
                updatePositionState();
            }, 500);
        });
        navigator.mediaSession.setActionHandler('seekto', function(evt) {
            if (evt.fastSeek && ('fastSeek' in audioElementObject)) {
                audioElementObject.fastSeek(evt.seekTime);
                return;
            }
            audioElementObject.currentTime = evt.seekTime;
            setTimeout(function(){
                updatePositionState();
            }, 500);
        });
        navigator.mediaSession.setActionHandler('previoustrack', function() {
            previousSong();
        });
        navigator.mediaSession.setActionHandler('nexttrack', function() {
            nextSong();
        });
    }
}

function updateTitle(title, artist, albumn){
    if ('mediaSession' in navigator) {
        if (navigator.mediaSession.metadata){
            //Media Session created. Update the existsing one instead
            navigator.mediaSession.metadata.title = title;
            navigator.mediaSession.metadata.artist = artist;
            navigator.mediaSession.metadata.album = albumn;
        }else{
            //Media Session not created. Creat one
            navigator.mediaSession.metadata = new MediaMetadata({
            title: title,
            artist: artist,
            album: albumn,
            /*artwork: [
                { src: artwork,   sizes: '480x480',   type: 'image/jpg' }
            ]*/
            });
        }

    }
}


function updatePositionState(currentTime, duration) {
    if (isNaN(currentTime) || isNaN(duration)){
        return;
    }

    if ('setPositionState' in navigator.mediaSession) {
        navigator.mediaSession.setPositionState({
            duration: audioElement[0].duration,
            playbackRate: audioElement[0].playbackRate,
            position: audioElement[0].currentTime
        });
    }

}