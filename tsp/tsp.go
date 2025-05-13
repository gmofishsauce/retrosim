package main

import (
	"fmt"
	"io/ioutil"
	"os"
	"strings"
)

func main() {
	fmt.Fprintf(os.Stderr, "firing up...\n")
	files := os.Args[1:]
	if len(files) != 1 {
		fmt.Fprintf(os.Stderr, "Usage: tsp netlist-file\n")
		os.Exit(1)
	}
	netlist, err := ioutil.ReadFile(files[0])
	if err != nil {
		fmt.Fprintf(os.Stderr, "%s: %v\n", os.Args[0], err)
		os.Exit(1)
	}
	if err := transpile(string(netlist)); err != nil {
		fmt.Fprintf(os.Stderr, "transpile failed: %v\n", err)
		os.Exit(2)
	}
	fmt.Fprintf(os.Stderr, "done\n")
	os.Exit(0)
}

// Token represents a token in an S-expression
type Token struct {
	Type  int
	Line  int
	Value string
}

const (
	SYMBOL = 1
	LPAREN = 2
	RPAREN = 3
)

// Tokenize takes an S-expression string and returns a slice of Tokens
// Unlike most tokenizers, this one includes an (approximate) source line
// number in each token for better error messages. 
func Tokenize(input string) ([]Token, error) {
	var tokens []Token
	var currentToken string
	var currentLine = 1
	var inString bool
	var escapeSeen bool

	for _, r := range input {
		switch r {
		case '(':
			if inString {
				currentToken += string(r)
			} else if currentToken != "" {
				return nil, fmt.Errorf("open paren in symbol near line %d", currentLine)
			} else {
                tokens = append(tokens, Token{LPAREN, currentLine, "("})
            }
		case ')':
			if inString {
				currentToken += string(r)
			} else if currentToken != "" {
				tokens = append(tokens, Token{SYMBOL, currentLine, currentToken})
				currentToken = ""
				tokens = append(tokens, Token{RPAREN, currentLine, ")"})
			} else {
                tokens = append(tokens, Token{RPAREN, currentLine, ")"})
            }
		case '"':
			if escapeSeen {
				currentToken += string(r)
			} else {
				inString = !inString
				if currentToken != "" {
					tokens = append(tokens, Token{SYMBOL, currentLine, currentToken})
					currentToken = ""
				}
			}
		case ' ', '\t', '\n':
			if inString {
				currentToken += string(r)
			} else if currentToken != "" {
				tokens = append(tokens, Token{SYMBOL, currentLine, currentToken})
				currentToken = ""
			}
			if r == '\n' {
				currentLine++
			}
		case 'n':
			if inString && escapeSeen {
				currentToken += string('\n')
			} else {
				currentToken += string(r)
			}
		case 't':
			if inString && escapeSeen {
				currentToken += string('\t')
			} else {
				currentToken += string(r)
			}
		case '\\':
			if !inString {
				currentToken += string(r)
			}
		default:
			currentToken += string(r)
		}

		escapeSeen = inString && (r == '\\')
	}

    if currentToken != "" {
		fmt.Fprintf(os.Stderr, "warning: file not properly terminated\n");
		tokens = append(tokens, Token{SYMBOL, currentLine, currentToken})
	}

	return tokens, nil
}

// Parser

var stack []string	// stack of strings Names identifying a model node

type ModelNode struct {
	Name string
	Value []string
	Parent *ModelNode
	Children []*ModelNode
}

var currentNode *ModelNode

func (m *ModelNode) String() string {
	var sb strings.Builder
	sb.WriteString("[")
	sb.WriteString(m.Name)
	sb.WriteString(" ")
	if len(m.Value) == 0 {
		sb.WriteString("- ")
	} else {
		sb.WriteString("(")
		sb.WriteString(m.Value[0])
		if len(m.Value) > 1 {
			sb.WriteString("...")
		}
		sb.WriteString(") ")
	}
	if m.Parent == nil {
		sb.WriteString("- ")
	} else {
		sb.WriteString(m.Parent.Name)
	}
	// don't bother with children
	sb.WriteString("]")
	return sb.String()
}

func fullname() string {
	var sb strings.Builder
	for _, s := range stack[1:] {
		sb.WriteRune(':')
		sb.WriteString(s)
	}
	return sb.String()
}

func enter(t Token) error {
	//fmt.Fprintf(os.Stderr, "enter %v\n", t)
	stack = append(stack, t.Value)
	m := &ModelNode{t.Value, []string{}, currentNode, []*ModelNode{}}
	currentNode = m
	fmt.Fprintf(os.Stderr, "currentNode: %s\n", currentNode)
	return nil
}

func leave() error {
	//fmt.Fprintf(os.Stderr, "leave %s\n", stack[len(stack)-1])
	stack = stack[:len(stack)-1]
	currentNode = currentNode.Parent
	return nil
}

func stash(t Token) error {
	currentNode.Value = append(currentNode.Value, t.Value)
	fmt.Fprintf(os.Stderr, "stash %s\n", currentNode)
	return nil
}

const (
	INITIAL = 0
	OPENING = 1
	NEED_ANY = 2
)

func transpile(netlist string) error {
	tokens, err := Tokenize(netlist)
	if err != nil {
		return err
	}

	var state = INITIAL
	for _, token := range tokens {
		fmt.Printf("Type: %d, Value: %s\n", token.Type, token.Value)

		switch (token.Type) {
		case LPAREN:
			if state == OPENING {
				// paren following paren with no "key" symbol between
				return fmt.Errorf("unbalanced open near line %d", token.Line)
			}
			state = OPENING
			break
		case RPAREN:
			if state != NEED_ANY || len(stack) == 0 {
				// This error will occur for "()", which may not be an error
				return fmt.Errorf("unbalanced close near line %d", token.Line)
			}
			if err = leave(); err != nil {
				return err
			}
		case SYMBOL:
			if state == OPENING {
				enter(token)
			} else {
				stash(token)
			}
			state = NEED_ANY
		}
	}

	return nil
}
