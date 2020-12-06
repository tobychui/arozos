package renderer

import (
	. "github.com/fogleman/fauxgl"
	"github.com/nfnt/resize"

	"errors"
	"image"
	"log"
	"os"
	"path/filepath"
	"strings"
)

const (
	scale  = 1    // optional supersampling
	width  = 1000 // output width in pixels
	height = 1000 // output height in pixels
	fovy   = 10   // vertical field of view in degrees
	near   = 1    // near clipping plane
	far    = 40   // far clipping plane
)

var (
	eye        = V(-6, -6, 5)             // camera position
	center     = V(0, -0.07, 0)           // view center position
	up         = V(0, 0, 1)               // up vector
	light      = V(-1, -2, 5).Normalize() // light direction
	color      = ("#42f5b3")              // object color
	background = HexColor("#e0e0e0")      //Background color
)

type RenderOption struct {
	Color           string
	BackgroundColor string
	Width           int
	Height          int
}

type Renderer struct {
	Option RenderOption
}

func NewRenderer(option RenderOption) *Renderer {
	return &Renderer{
		Option: option,
	}
}

func (r *Renderer) RenderModel(filename string) (image.Image, error) {
	// load a mesh
	var mesh *Mesh
	if strings.ToLower(filepath.Ext(filename)) == ".stl" {
		m, err := LoadSTL(filename)
		if err != nil {
			return nil, err
		}
		mesh = m
	} else if strings.ToLower(filepath.Ext(filename)) == ".obj" {
		m, err := LoadOBJ(filename)
		if err != nil {
			return nil, err
		}
		mesh = m
	} else {
		log.Println("Not supported format, given: " + filepath.Ext(filename))
		return nil, errors.New("Not supported model format")
	}

	// fit mesh in a bi-unit cube centered at the origin
	mesh.UnitCube()
	//log.Println(mesh.BoundingBox(), filename)
	// smooth the normals
	mesh.SmoothNormalsThreshold(Radians(30))

	// create a rendering context
	context := NewContext(r.Option.Width*scale, r.Option.Height*scale)
	context.ClearColorBufferWith(HexColor(r.Option.BackgroundColor))

	// create transformation matrix and light direction
	aspect := float64(width) / float64(height)
	matrix := LookAt(eye, center, up).Perspective(fovy, aspect, near, far)

	// use builtin phong shader
	shader := NewPhongShader(matrix, light, eye)
	shader.ObjectColor = HexColor(r.Option.Color)
	context.Shader = shader

	// render
	context.DrawMesh(mesh)

	// downsample image for antialiasing
	image := context.Image()
	image = resize.Resize(width, height, image, resize.Bilinear)

	return image, nil
}

func fileExists(filename string) bool {
	info, err := os.Stat(filename)
	if os.IsNotExist(err) {
		return false
	}
	return !info.IsDir()
}
