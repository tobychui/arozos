/*
    Localization

    To add more locales, add to the html file with // (translated text)
    after each DOM elements with attr i18n

    And then add the language ISO key to the list below.
*/
let languages = ['en', 'zh', 'jp', 'zh-cn'];


//Bind language change dropdown events
$(".dropdown").dropdown();
$("#language").on("change",function(){
   let newLang = $("#language").parent().dropdown("get value");
   i18n.changeLanguage(newLang);
   $("body").attr("class", newLang);
});

//Initialize the i18n dom library
var i18n = domI18n({
    selector: '[i18n]',
    separator: ' // ',
    languages: languages,
    defaultLanguage: 'en'
});
i18n.changeLanguage('en');

/* Main Menu */
$("#rwdmenubtn").on("click", function(){
    $("#mainmenu").slideToggle("fast");
})

//Handle resize 
$(window).on("resize", function(){
    if (window.innerWidth > 960){
        $("#mainmenu").show();
    }else{
        $("#mainmenu").hide();
    }
})

/*
    Slideshow rendering routine
*/
const slides = document.querySelector('.slides');
const slideCount = document.querySelectorAll('.slide').length;
let dots = document.querySelectorAll('.dot');
let currentIndex = 0;
let slideInterval;


//Generate the dots per slides
function initSlideshowDots(){
    let imageSlides = $(".slideshow").find(".slide");
    for(var i=0; i<imageSlides.length; i++){
        $(".slideshow").find(".dots").append(`<span class="${i==0?"active":""} dot" onclick="currentSlide(${i})"></span>`);
    }
    dots = document.querySelectorAll('.dot');;
}
initSlideshowDots();

function showNextSlide() {
    currentIndex = (currentIndex + 1) % slideCount;
    updateSlidePosition();
}

function currentSlide(index) {
    currentIndex = index;
    updateSlidePosition();
    resetInterval();
}

function updateSlidePosition() {
    const offset = -currentIndex * 100;
    slides.style.transform = `translateX(${offset}%)`;
    updateDots();
}

function updateDots() {
    dots.forEach((dot, index) => {
        dot.classList.toggle('active', index === currentIndex);
    });
}

function resetInterval() {
    clearInterval(slideInterval);
    slideInterval = setInterval(showNextSlide, 5000);
}

slideInterval = setInterval(showNextSlide, 5000);

dots.forEach((dot, index) => {
    dot.addEventListener('click', () => currentSlide(index));
});

/*
    Download
*/

$('.menu .item').tab();

//Download webpack and binary at the same time
function handleDownload(releasename){
    let binaryURL = "https://github.com/tobychui/arozos/releases/latest/download/" + releasename;
    window.open(binaryURL);
}

function handleGetWebpack(){
    let webpackURL = "https://github.com/tobychui/arozos/releases/latest/download/web.tar.gz";
    window.open(webpackURL);
}

/* RWD */
window.addEventListener('scroll', function() {
    var scrollPosition = window.scrollY || window.pageYOffset;
    var windowHeight = window.innerHeight;
    var hiddenDiv = document.querySelector('#backToTopBtn');

    if (scrollPosition > windowHeight / 2) {
    hiddenDiv.style.display = 'block';
    } else {
    hiddenDiv.style.display = 'none';
    }
});


function backToTop(){
    $('html, body').animate({scrollTop : 0},800, function(){
        window.location.hash = "";
    });
}