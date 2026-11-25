package console

import (
	"bufio"
	"fmt"
	"os"
	"strings"

	"imuslab.com/arozos/mod/info/logger"
)

type Console struct {
	Handler func(string) string
}

func NewConsole(handler func(string) string) *Console {
	logger.DebugTrace("console", "NewConsole")
	return &Console{
		Handler: handler,
	}
}

func (c *Console) ListenAndHandle() {
	defer logger.Out0(logger.In1("console", "Console.ListenAndHandle", "c", c))
	for {
		reader := bufio.NewReader(os.Stdin)
		text, _ := reader.ReadString('\n')
		text = strings.TrimSpace(text)
		if len(text) > 0 {
			fmt.Println("▌" + c.Handler(text))
		} else {
			fmt.Println("▌Invalid Command")
		}
	}
}
