/* 
 JSQL by dean. MYSQL type queries for javascript datasets.
 because when pizza's on a bagel, you can have pizza anytime.
 
 EXAMPLE:
 
 var tables = {
 'people' : [{id:5, name:"joe"},
 {id:4, name:"ralph"}],
 
 'jobs'   : [{id:4, title:"CEO", salary: 100},
 {id:3, title:"janitor", salary: 50}]
 
 };
 
 //supports user defined functions
 sq = function(x){
 return x*x;
 }
 
 var _q = "SELECT people.name, sq(jobs.salary) AS sal_sq, (jobs.salary > 50 ? true : false) AS over_100 FROM people JOIN jobs ON jobs.id = people.id WHERE jobs.title = 'CEO'";
 
 jsql(_q, tables);
 
 WILL RETURN:
 array of length one:
 
 [{ 	over_100:       true
 people.name: 	"ralph"
 sal_sq: 	10000   }]
 
 //---------------------------//
 CURRENTLY ALSO SUPPORTS:
 - wildcard selects
 - GROUP BY operations (across multiple columns)
 - SUM function
 - user defined and built in JS functions
 
 NOT YET SUPPORTED:
 - LIMIT
 - COUNT grouping function (just do SUM((table.col ? 1 : 0)) for now)
 - Subqueries
 - shorthand table names (you must specify the entire table name for each column you are selecting even if data is being selected from one table)
 
 Support will be added whenever I can justify need
 
 */

//Replaces all MYSQL syntax conditionals with js conditionals
function jsql_replace_conditionals(query) {
    query = query.replace(/(?!==)=/g, "==");
    query = query.replace(/\sAND\s/ig, " && ");
    query = query.replace(/\sOR\s/ig, " || ");
    return query;
}

function jsql_replace_table_names(query, tbls, prefix) {
    for (var i in tbls) {
        var re = new RegExp("\(?!\\w" + tbls[i] + ")(" + tbls[i] + ")(?=\\.)", "g");
        query = query.replace(re, " " + prefix + ".$1");
    }
    return query;
}

function jsql_join(query, tmp, dependencies) {
    //process given query on the existing tmp data with the passed dependencies
    if (!tmp || !tmp.length) {
        return [];
    }
    else {
        var type, t;
        var ret_tbl = [];
        if (query.match(/^JOIN\s/i)) {
            type = "JOIN";
        }
        else if (query.match(/^LEFT\sJOIN\s/i)) {
            type = "LEFT JOIN";
        }
        else {
            //throw an error if weird type of join
            throw "no join clause found in: " + query;
        }

        var t_name = query.match(/JOIN\s(.*?)\s/i)[1];
        if (!t_name || !dependencies.hasOwnProperty(t_name)) {
            //throw an error
            throw "table join error near: " + query;
        }
        else {
            var t = dependencies[t_name];
            //process the ON clause if there is one
            var on = query.match(/ON\s(.*)/)[1];
            if (on) {
                //join using the on clause
                //get existing column names
                var tbls = Object.keys(tmp[0]);

                on = jsql_replace_table_names(on, tbls, "row");

                //replace join table name
                var re = new RegExp("\(\\s|^)(" + t_name + ")\\.", "g");
                on = on.replace(re, " _row2.");
                on = jsql_replace_conditionals(on);
                on = on.trim();

                for (var i in tmp) {
                    var row = tmp[i];
                    var match = false;
                    for (var k in t) {
                        var _row2 = t[k];
                        //if all join conditions are met, copy the row and push it to the return array
                        if (eval(on)) {
                            var cp = Object.assign({}, row);
                            cp[t_name] = _row2;
                            ret_tbl.push(cp);
                            match = true;
                        }
                    }
                    if (type == 'LEFT JOIN' && !match) {
                        //put a null row in, no match was found
                        var cp = Object.assign({}, row);
                        var cp2 = Object.assign({}, t[0]);
                        var keys = Object.keys(cp2);
                        for (var k in keys) {
                            cp2[keys[k]] = null;
                        }
                        cp[t_name] = cp2;
                        ret_tbl.push(cp);
                    }
                }
            }
            else {
                //TODO: join on all rows
            }
            return ret_tbl;
        }
    }
}

function jsql_build(query, dependencies, type) {
    var tmp = [];

    //pull out FROM ... all the way to (WHERE | LIMIT | GROUP BY | $)
    var reg = query.match(/(FROM|UPDATE)\s.*?(WHERE|GROUP\sBY|LIMIT|$)/ig);
    if (!reg || reg.length !== 1) {
        //throw an error
        throw "Error in syntax: " + query;
    }
    else {
        //parse joins
        var joins = reg[0].match(/(JOIN|LEFT\sJOIN|FROM|UPDATE)\s.*?(?=JOIN|LEFT\sJOIN|WHERE|LIMIT|GROUP\sBY|SET|$)/ig);
        if (!joins.length) {
            //throw an error
            throw "Error in syntax: " + joins;
        }
        else {
            var from = joins[0].split(" ");
            //we need a FROM statement in a select
            if (type === "SELECT") {
                if (from[0].toUpperCase() !== "FROM" || (from[2] && from[2] !== "")) {
                    //throw an error if the first clause is not a FROM or if stuff is weird
                    throw "weird stuff in query: " + from[2];
                }
            }
            var t1_name = from[1];
            if (!dependencies.hasOwnProperty(t1_name)) {
                //throw an error, table does not exist
                throw "Table in FROM clause does not exist!: " + t1_name;
            }
            else {
                for (var i in dependencies[t1_name]) {
                    var o = {};
                    o[t1_name] = dependencies[t1_name][i];
                    tmp.push(o);
                }
                joins.shift();
            }

            //now process all joins
            while (joins.length) {
                tmp = jsql_join(joins[0], tmp, dependencies);
                joins.shift();
            }
            return tmp;
        }
    }
}

function jsql_where(query, tmp) {
    if (!tmp || !tmp.length) {
        return [];
    }
    else {
        //takes the full built temporary table and filter out relevant data
        var reg = query.match(/WHERE\s(.*?)(?=GROUP\sBY|LIMIT|ORDER\sBY|$)/ig);
        if (reg) {
            if (reg.length > 1) {
                //throw an error
                throw "Error in syntax: " + query;
            }
            else {
                var where = reg[0].match(/WHERE\s(.*)/)[1];
                var tbls = Object.keys(tmp[0]);

                where = jsql_replace_table_names(where, tbls, "row");
                where = jsql_replace_conditionals(where);

                tmp = $.grep(tmp, function(row) {
                    return eval(where);
                });
            }
        }
        return tmp;
    }
}

function jsql_group(query, tmp) {
    var ret_tbl = [];
    var groups = [];
    if (!tmp || !tmp.length) {
        return [];
    }
    else {
        //check for a group by clause
        var reg = query.match(/GROUP\sBY\s(.*?)(?=LIMIT|ORDER\sBY|$)/i);
        if (!reg) {
            return [tmp];
        }
        else {
            var group_by = reg[1];
            var keys = group_by.split(",");
            for (var k in keys) {
                keys[k] = keys[k].trim();
            }

            for (var r in tmp) {
                var row = tmp[r];
                var group_match = false;
                for (var g in groups) {
                    var group = groups[g];
                    var match = 0;
                    for (var k in keys) {
                        if (eval("row." + keys[k] + " == group.keys[keys[k]]")) {
                            match = match + 1;
                        }
                    }
                    if (match == keys.length) {
                        group.values.push(row);
                        group_match = true;
                        break;
                    }
                }
                if (!group_match) {
                    var g_keys = {};
                    for (var k in keys) {
                        g_keys[keys[k]] = eval("row." + keys[k]);
                    }
                    groups.push({keys: g_keys, values: [row]});
                }
            }
            for (var g in groups) {
                ret_tbl.push(groups[g].values);
            }
            return ret_tbl;
        }
    }
}

function jsql_process(row, aliases, tbls, r_new) {
    for (o in aliases) {

        //----process special wildcard selects-----//
        if (aliases[o].expression.indexOf("*") > -1) {
            if (aliases[o].expression.indexOf(".*") > -1) {
                var tb = aliases[o].expression.slice(5, -2);
                jQuery.extend(r_new, row[tb]);
            }
            else if (aliases[o].expression === "*") {
                //return everything
                for (var k in tbls) {
                    jQuery.extend(r_new, row[tbls[k]]);
                }
            }
            //otherwise it must just be a multiply expression
            else {
                r_new[aliases[o].alias] = eval(aliases[o].expression);
            }
        }

        //----process normal selects------//
        else {
            r_new[aliases[o].alias] = eval(aliases[o].expression);
        }
    }
}

//make sure there are no syntax errors
var testcombine = function(ar){
    var ret = [];
    for(var j = 0; j<ar.length; j++){
        try {
            eval(ar[j].match(/(.*?)(?=\sAS\s|$)/i)[0].trim());
            ret.push(ar[j]);
        } catch (e) {
            if (e instanceof SyntaxError) {
                var n = [];
                if(j + 1 in ar){
                  n.push(ar[j] + ',' + ar[j + 1]);
                  if(j + 2 in ar){
                    n = n.concat(ar.slice(j + 2));
                  }
                  ret = ret.concat(testcombine(n));
                  break;
                }
                else{
                    throw "you have a syntax error near: " + ar[j];
                }
            }
            else{
              ret.push(ar[j]);
            }
        }
    }
    return ret;
}

function jsql_select(query, dependencies) {
    //first lets build the full dataset
    var ret_tbl = [];

    var tmp = jsql_build(query, dependencies, 'SELECT');
    tmp = jsql_where(query, tmp);

    //preliminary group check
    var group = false;
    if (query.match(/((?!\wSUM|\.SUM)SUM\s*\(|(?!\wCOUNT|\.COUNT)COUNT\s*\(|GROUP\sBY)/ig)) {
        group = true;
        tmp = jsql_group(query, tmp);
    }

    if (!tmp || !tmp.length) {
        return [];
    }
    else {
        var q = query.match(/SELECT\s(.*)(?=\sFROM)/i)[1];
        
        var cols = q.split(",");//split by commas that are not escaped
        cols = testcombine(cols); //check for syntax errors and make sure we are not messing up anyones query
        var aliases = [];
        var tbls = (group ? Object.keys(tmp[0][0]) : Object.keys(tmp[0]));
        for (var c in cols) {
            cols[c] = cols[c].trim();

            //parse out column aliases if any are given
            var o = {
                alias: '',
                expression: cols[c].match(/(.*?)(?=\sAS\s|$)/i)[0].trim()
            };
            o.alias = o.expression;
            //check for a passed alias
            var a = cols[c].match(/AS\s(.*)/i);
            if (a) {
                o.alias = a[1];
            }

            //replace table names and conditionals
            o.expression = jsql_replace_conditionals(o.expression);
            o.expression = jsql_replace_table_names(o.expression, tbls, "row");

            if (group) {
                //replace any group functions
                o.expression = o.expression.replace(/(?!\wSUM|\.SUM)SUM\s*\((.*?)(?=\))/, "(r_new['" + o.alias + "'] || 0) + ($1");
                //TODO: add count function
            }
            aliases.push(o);
        }

        //now get all the data
        for (var i in tmp) {
            var r_new = {};
            var row = tmp[i];
            if (!group) {
                jsql_process(row, aliases, tbls, r_new);
                ret_tbl.push(r_new);
            }
            else {
                for (var g in row) {
                    jsql_process(row[g], aliases, tbls, r_new);
                }
                ret_tbl.push(r_new);
            }
        }
        return ret_tbl;
    }
}

function jsql_update(query, dependencies) {
    //first lets build the full dataset
    var tmp = jsql_build(query, dependencies, 'UPDATE');
    tmp = jsql_where(query, tmp);

    var re = query.match(/\sSET\s(.*?)(?=WHERE|LIMIT|$)/i);
    if (!re) {
        throw "Error near SET clause in query: " + query;
    }
    else {
        var tbls = Object.keys(tmp[0]);
        query = jsql_replace_table_names(re[1], tbls, "row");
        var cols = query.split(",");
        for (var i in cols) {
            cols[i] = cols[i].trim();
        }

        //make the updates
        for (var i in tmp) {
            var row = tmp[i];
            for (var c in cols) {
                eval(cols[c]);
            }
        }
    }
    return true;
}

function jsql(query, dependencies) {
    /*
     * Evaluate a query (string) on an object of (name, data) dependancy objects
     */

    //preliminary check that dependencies are valid
    if (typeof dependencies !== "object" || !Object.keys(dependencies).length) {
        throw "dependancies parameter must be an object and cannot be empty";
    }
    for (var d in dependencies) {
        if (dependencies[d].constructor !== Array) {
            throw "all dependencies must be of type array";
        }
    }

    var sp1 = query.split(" ");
    if (sp1[0].toUpperCase() === "SELECT") {
        return jsql_select(query, dependencies);
    }
    else if (sp1[0].toUpperCase() === "UPDATE") {
        return jsql_update(query, dependencies);
    }
    //TODO Add other things
    else {
        //throw an error
        throw "error in query " + query;
    }
}