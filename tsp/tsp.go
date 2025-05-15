package main

import (
	"fmt"
	"io/ioutil"
	"os"
	"strings"
)

var debug bool

func msg(format string, a ...any) (n int, err error) {
	n, err = fmt.Fprintf(os.Stderr, format, a...)
	return n, err
}

func dbg(format string, a ...any) (n int, err error) {
	if debug {
		n, err = fmt.Fprintf(os.Stderr, format, a...)
		return n, err
	}
	return 0, nil
}

func main() {
	msg("firing up...\n")
	files := os.Args[1:]
	if len(files) != 1 {
		msg("Usage: tsp netlist-file\n")
		os.Exit(1)
	}
	netlist, err := ioutil.ReadFile(files[0])
	if err != nil {
		msg("%s: %v\n", os.Args[0], err)
		os.Exit(1)
	}
	if err := transpile(string(netlist)); err != nil {
		msg("transpile failed: %v\n", err)
		os.Exit(2)
	}
	msg("done\n")
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
// Unlike most S-expr tokenizers, this one includes an (approximate)
// source line number in each token for better error messages. 
func Tokenize(input string) ([]Token, error) {
	var tokens []Token
	var currentToken string
	var currentLine = 1
	var inString bool
	var escapeSeen bool

	// N.B. the escapeSeen state is managed by a single line of code near the
	// very end of this loop. It's easy to miss, but otherwise we'd need to
	// clear the escape state in many places, and it would be easy to miss one.
	for _, r := range input {
		switch r {
		case '(':
			if inString {
				currentToken += string(r)
			} else if currentToken != "" {
				// Open parens need to be preceded by white space. This rule is likely
				// incorrect for S-exprs in generally, but helps with KiCad exports.
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
			} else if inString && escapeSeen {
				currentToken += string(r)
			}
		default:
			currentToken += string(r)
		}

		escapeSeen = inString && !escapeSeen && (r == '\\')
	}

    if currentToken != "" {
		return nil, fmt.Errorf("netlist has mismatched parens", currentLine)
	}

	return tokens, nil
}

// Parser. Creates a tree of ModelNodes.

type ModelNode struct {
	Name string
	Value []string
	Parent *ModelNode
	Children []*ModelNode
}

func (m *ModelNode) String() string {
	var sb strings.Builder
	sb.WriteString("[")
	sb.WriteString(m.Name)
	sb.WriteString(" ")
	if len(m.Value) == 0 {
		sb.WriteString("- ")
	} else {
		sb.WriteString("\"")
		sb.WriteString(m.Value[0])
		if len(m.Value) > 1 {
			sb.WriteString("...")
		}
		sb.WriteString("\" ")
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

const (
	INITIAL = 0
	OPENING = 1
	NEED_ANY = 2
)

// Parse hides the tokenizer from callers.
// The returned value is tree of ModelNode.
func parse(netlist string) (*ModelNode, error) {
	tokens, err := Tokenize(netlist)
	if err != nil {
		return nil, err
	}

	var state = INITIAL
	var currentNode *ModelNode
	var previousNode *ModelNode

	for _, token := range tokens {
		//fmt.Printf("Type: %d, Value: %s\n", token.Type, token.Value)

		switch (token.Type) {
		case LPAREN:
			if state == OPENING {
				// left paren following left paren with no "key" symbol between
				return nil, fmt.Errorf("unbalanced open near line %d", token.Line)
			}
			state = OPENING
		case RPAREN:
			if state != NEED_ANY || currentNode == nil {
				// This error will occur for "()", which may not be an error
				return nil, fmt.Errorf("unbalanced close near line %d", token.Line)
			}
			previousNode = currentNode
			currentNode = currentNode.Parent
		case SYMBOL:
			if state == OPENING {
				c := &ModelNode{token.Value, []string{}, currentNode, []*ModelNode{}}
				if currentNode != nil {
					// I hate these if's that are only true once...
					currentNode.Children = append(currentNode.Children, c)
				}
				currentNode = c
				dbg("currentNode: %s\n", currentNode)
			} else {
				currentNode.Value = append(currentNode.Value, token.Value)
				dbg("stash %s in %s\n", token.Value, currentNode)
			}
			state = NEED_ANY
		}
	}
	// As we climbed back up the tree due to one or more closing parens at the end,
	// the current node became nil but the prevous node at that point is the root.
	return previousNode, nil
}

// OK, process the tree of model nodes into some C code

func dump(m *ModelNode, indent int) {
	msg("%s%s\n", strings.Repeat(" ", 2*indent), m)
	for _, c := range m.Children {
		dump(c, 1+indent)
	}
}

// Find ModelNodes named "string" in the children of ModelNode m
func find(m *ModelNode, name string) []*ModelNode {
	var result []*ModelNode
	for _, c := range m.Children {
		if name == c.Name {
			result = append(result, c)
		}
	}
	return result
}

// Return a set of ModelNodes named a:b:c... where the node "a"
// is a child of the root node. Multiple hits are possible at
// every level.
func q(root *ModelNode, selector string) []*ModelNode {
	names := strings.Split(selector, ":")
	candidates := []*ModelNode{root}
	var newCandidates []*ModelNode

	if len(names) == 0 {
		return []*ModelNode{}
	}
	for _, n := range names {
		for _, c := range candidates {
			newCandidates = append(newCandidates, find(c, n)...)
		}
		if len(newCandidates) == 0 {
			return newCandidates
		}
		candidates = newCandidates
		newCandidates = newCandidates[:0]
	}
	return candidates
}

// Remove quotes from a (properly) quote string. The quoted
// string may be empty, but must have either balanced quotes
// or no quotes.
func dequote(s string) string {
	if len(s) < 2 {
		return s
	}
	start := 0
	end := len(s) - 1
	if s[start] == '"' {
		start = 1
	}
	if s[end] == '"' {
		end--
	}
	return s[start:end]
}

// Return the value field of a single ModelNode as a string
// with quotes removed. Since this program is a transpiler,
// in-band error returns are used: if the query returns no
// nodes, the return value is NOTFOUND and if the query returns
// multiple nodes, the return value is MULTIPLE.
func qss(root *ModelNode, selector string) string {
	result := q(root, selector)
	if len(result) == 0 {
		return "NOTFOUND"
	}
	if len(result) > 1 {
		return "MULTIPLE"
	}
	if len(result[0].Value) == 0 {
		return "NOTFOUND"
	}
	if len(result[0].Value) > 1 {
		return "MULTIPLE"
	}
	return dequote(result[0].Value[0])
}

func runSomeTests(root *ModelNode) error {
	dump(root, 0)

	qstr := "version"
	single := q(root, qstr)
	if len(single) != 1 {
		msg("q(root, %s) found %d nodes!?\n", qstr, len(single))
		return fmt.Errorf("query failed: %s", qstr)
	}
	msg("%s: %v\n", qstr, single[0].Value)

	qstr = "version"
	ss := qss(root, qstr)
	if ss == "NOTFOUND" || ss == "MULTIPLE" {
		msg("q(root, %s) returned %s\n", qstr, ss)
		return fmt.Errorf("query failed: %s", qstr)
	}
	msg("%s: %s\n", qstr, ss)

	qstr = "design:sheet:title_block:company"
	single = q(root, qstr)
	if len(single) != 1 {
		msg("q(root, %s) found %d nodes!?\n", qstr, len(single))
		return fmt.Errorf("query failed: %s", qstr)
	}
	msg("%s: %s\n", qstr, single[0].Value)

	msg("some tests passed\n")
	return nil
}

func emit(format string, a ...any) (n int, err error) {
	n, err = fmt.Printf(format, a...)
	return n, err
}

func topComment(root *ModelNode) error {
	schemaVersion := qss(root, "version")
	emit("EMIT: %s\n", schemaVersion)
	return nil
}

func transpile(netlist string) error {
	root, err := parse(netlist)
	if err != nil {
		return err
	}
	msg("parse complete, transpiling...\n")
	runSomeTests(root)

	if err = topComment(root); err != nil {
		return err
	}
	return nil
}
